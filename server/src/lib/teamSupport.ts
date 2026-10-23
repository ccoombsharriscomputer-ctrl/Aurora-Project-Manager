// TeamSupport shards accounts across regional servers (NA1, NA2, NA3, NA4) — NA1 happens to
// be reachable at the bare "app.teamsupport.com", but every other server needs its own
// subdomain (e.g. "app.na2.teamsupport.com"). There's no way to know which one an account is
// on without being told, so this must be configurable rather than assumed.
function apiBaseUrl(): string {
  return (process.env.TEAMSUPPORT_API_BASE_URL || "https://app.teamsupport.com").replace(/\/$/, "");
}

export class TeamSupportNotConfiguredError extends Error {}
export class TeamSupportTicketNotFoundError extends Error {}

// Carries the upstream HTTP status (or a network-level failure reason when there was no
// response at all) so callers can return a diagnostic-enough message without needing
// production log access to tell "wrong credentials" apart from "can't connect".
export class TeamSupportUpstreamError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

export interface TeamSupportTicket {
  ticketNumber: string;
  name: string;
  status: string;
  severity: string | null;
  groupName: string | null;
  assigneeName: string | null;
}

function authHeader(): string {
  const orgId = process.env.TEAMSUPPORT_ORG_ID;
  const apiToken = process.env.TEAMSUPPORT_API_TOKEN;
  if (!orgId || !apiToken) {
    throw new TeamSupportNotConfiguredError("TeamSupport is not configured");
  }
  return `Basic ${Buffer.from(`${orgId}:${apiToken}`).toString("base64")}`;
}

// Shared request plumbing for both reading tickets and posting actions — same auth, same
// base URL resolution, same network/HTTP-status/JSON-parse error handling so both paths
// degrade the same way (and log the same diagnostic detail) when something's misconfigured.
async function teamSupportRequest(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${apiBaseUrl()}${path}`;
  // Computed before the try block so TeamSupportNotConfiguredError propagates as itself
  // rather than being caught and relabeled as a generic network error below.
  const authorization = authHeader();

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Authorization: authorization, Accept: "application/json", ...init?.headers },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[teamSupport] network error calling ${url}: ${message}`);
    throw new TeamSupportUpstreamError(`Network error reaching TeamSupport: ${message}`, null);
  }

  if (response.status === 404) {
    throw new TeamSupportTicketNotFoundError(`Not found: ${path}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[teamSupport] ${url} returned HTTP ${response.status}: ${body.slice(0, 500)}`);
    throw new TeamSupportUpstreamError(`TeamSupport returned HTTP ${response.status}`, response.status);
  }

  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[teamSupport] failed to parse JSON from ${url}: ${message}`);
    throw new TeamSupportUpstreamError(`TeamSupport returned a response that wasn't valid JSON`, response.status);
  }
}

// TeamSupport's legacy JSON API isn't consistently RESTful about wrapping a single resource —
// depending on account/API version it may return the ticket object directly, inside a
// `{ Tickets: [...] }` list, or inside a `{ Ticket: {...} }` wrapper. Handle all three rather
// than betting on one shape.
function extractTicketPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw)) return (raw[0] as Record<string, unknown>) ?? null;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.Tickets)) return (obj.Tickets[0] as Record<string, unknown>) ?? null;
  if (obj.Ticket && typeof obj.Ticket === "object") return obj.Ticket as Record<string, unknown>;
  if ("ID" in obj || "TicketNumber" in obj) return obj;
  return null;
}

export async function fetchTicketByNumber(ticketNumber: string): Promise<TeamSupportTicket> {
  const raw = await teamSupportRequest(`/api/json/tickets/${encodeURIComponent(ticketNumber)}.json`).catch((err) => {
    if (err instanceof TeamSupportTicketNotFoundError) {
      throw new TeamSupportTicketNotFoundError(`Ticket ${ticketNumber} not found`);
    }
    throw err;
  });

  const payload = extractTicketPayload(raw);
  if (!payload) {
    console.error(`[teamSupport] unrecognized response shape for ticket ${ticketNumber}: ${JSON.stringify(raw).slice(0, 500)}`);
    throw new TeamSupportTicketNotFoundError(`Ticket ${ticketNumber} not found`);
  }

  return {
    ticketNumber: String(payload.TicketNumber ?? ticketNumber),
    name: String(payload.Name ?? ""),
    status: String(payload.Status ?? "Unknown"),
    severity: payload.Severity ? String(payload.Severity) : null,
    groupName: payload.GroupName ? String(payload.GroupName) : null,
    assigneeName: payload.UserName ? String(payload.UserName) : null,
  };
}

// TeamSupport's Action Type catalog is org-wide and covers every software line's own
// workflow, not just Professional Services'. These are just the "PS - ..." ones, captured
// directly from the Action Type dropdown in TeamSupport's ticket UI (Harris Computer's NA2
// instance) on 2026-07-28 — there's no public API endpoint for listing action types, so if
// TeamSupport admins add, rename, or remove a PS type later, this list needs a manual update.
export const PS_ACTION_TYPES: { id: string; name: string }[] = [
  { id: "34922", name: "PS - Scheduling/Coordinating" },
  { id: "34923", name: "PS - Server Install, User Setup" },
  { id: "34924", name: "PS - Data Audit/Issues" },
  { id: "34925", name: "PS - Data Conversion" },
  { id: "34926", name: "PS - License Delivery/Module Install" },
  { id: "34927", name: "PS - Go Live" },
  { id: "34928", name: "PS - Post Go-Live Support" },
  { id: "34929", name: "PS - Training" },
  { id: "34930", name: "PS - Support" },
  { id: "34931", name: "PS - Testing Jiras/Software Updates/Other" },
  { id: "34932", name: "PS - Project Management" },
  { id: "34933", name: "PS - Non-billable Customer Calls/Meetings" },
  { id: "30841", name: "PS - Onsite Visit" },
];

export interface PostTicketActionOptions {
  hours?: number;
  creatorId?: string | null;
  actionTypeId?: string | null;
  isPublic?: boolean;
  // Files to attach to the note once it exists (see postTicketActionAttachment).
  files?: TicketActionFile[];
}

export interface TicketActionFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

// Posts a new ticket action (TeamSupport's term for a note/comment on a ticket) via
// POST Tickets/{TicketNumber}/Actions — confirmed against TeamSupport's own published API
// endpoint reference. Time is a single TimeSpent field in total minutes (not HoursSpent, and
// not separate Hours/Minutes fields) — confirmed by intercepting the actual request
// TeamSupport's own web UI sends when saving time on an action. creatorId (a TeamSupport
// UserID) is attempted on a best-effort basis — TeamSupport may or may not honor a caller-
// specified author on top of the API-token identity; if it's silently ignored, the note
// still shows the real Aurora user's name in its text either way. IsVisibleOnPortal (Public
// vs Private) and ActionTypeID were both confirmed the same way, by intercepting TeamSupport's
// own "+ Public/Private Action" save requests.
export async function postTicketAction(
  ticketNumber: string,
  description: string,
  options: PostTicketActionOptions = {}
): Promise<string | null> {
  const { hours, creatorId, actionTypeId, isPublic = false } = options;
  const action: Record<string, unknown> = { Description: description, IsVisibleOnPortal: isPublic };
  if (hours) {
    action.TimeSpent = Math.round(hours * 60);
  }
  if (creatorId) {
    action.CreatorID = Number(creatorId);
  }
  if (actionTypeId) {
    action.ActionTypeID = Number(actionTypeId);
  }

  const raw = await teamSupportRequest(`/api/json/tickets/${encodeURIComponent(ticketNumber)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Action: action }),
  });
  // The response wraps the new action as { Action: { ActionID, ... } } (confirmed live
  // 2026-10-23) — that ID is what a file attachment needs to hang off.
  const created = (raw && typeof raw === "object" && "Action" in raw ? (raw as { Action: unknown }).Action : raw) as
    | Record<string, unknown>
    | null;
  const id = created?.ActionID ?? created?.ID;
  return id != null ? String(id) : null;
}

// Attaches one file to an existing ticket action: multipart upload to
// POST Tickets/{ticket}/Actions/{action}/Attachments.
export async function postTicketActionAttachment(
  ticketNumber: string,
  actionId: string,
  file: TicketActionFile
): Promise<void> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
  await teamSupportRequest(
    `/api/json/tickets/${encodeURIComponent(ticketNumber)}/actions/${encodeURIComponent(actionId)}/attachments`,
    { method: "POST", body: form }
  );
}

// TeamSupport renders Action descriptions as HTML, so a plain "\n" collapses away like any
// other whitespace in a browser — real line breaks need <br> tags instead.
function toHtmlLines(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return linkifyEscapedHtml(escaped).replace(/\n/g, "<br>");
}

// Turns pasted web addresses (https://..., http://..., www....) into clickable links. Runs on
// text that has already been HTML-escaped, so the address can go straight into href and the
// link text. Trailing punctuation (a full stop or closing bracket right after the address)
// stays outside the link.
function linkifyEscapedHtml(escaped: string): string {
  return escaped.replace(/(https?:\/\/|www\.)[^\s<]+/gi, (match) => {
    const trailing = match.match(/(?:[.,;:!?)\]]|&gt;|&quot;)+$/)?.[0] ?? "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    if (!url || /^(https?:\/\/|www\.)$/i.test(url)) return match;
    const href = /^www\./i.test(url) ? `http://${url}` : url;
    return `<a href="${href}">${url}</a>${trailing}`;
  });
}

// The sub-project + task line shown to TeamSupport right below the "Via <line> Project
// Manager" header — same name fallback (the sub-project's own name, else its product's) used
// everywhere else this app displays a sub-project.
export function teamSupportTaskContext(task: {
  title: string;
  subProject: { name: string | null; checklistItem: { name: string } };
}): string {
  return `${task.subProject.name || task.subProject.checklistItem.name} — ${task.title}`;
}

// Fire-and-forget: a comment or time log in Aurora should never fail (or wait) on
// TeamSupport being slow or unreachable, so this is deliberately not awaited by callers.
// The header names the specific software line's Project Manager (e.g. "Via TRIO Project
// Manager") rather than "Aurora" generically, since that's what actually means something to
// whoever reads the note in TeamSupport — same for every software line, not just TRIO.
// taskContext (the sub-project and task the update came from) sits right below that header,
// before the actual comment/time-log body, so a reader in TeamSupport — who has no other way
// to see Aurora's project structure — knows exactly where in the project this note came from.
export function syncTaskUpdateToTeamSupport(
  ticketNumber: string,
  body: string,
  productLineName: string,
  taskContext: string,
  options: PostTicketActionOptions = {}
) {
  const description = `Via ${productLineName} Project Manager<br>${toHtmlLines(taskContext)}<br><br>${toHtmlLines(body)}`;
  postTicketAction(ticketNumber, description, options)
    .then(async (actionId) => {
      const files = options.files ?? [];
      if (files.length === 0) return;
      if (!actionId) {
        console.error(`[teamSupport] note posted to ticket ${ticketNumber} but no action ID came back — ${files.length} file(s) not attached`);
        return;
      }
      // One at a time and independent: one bad file shouldn't stop the others.
      for (const file of files) {
        await postTicketActionAttachment(ticketNumber, actionId, file).catch((err) => {
          console.error(`[teamSupport] failed to attach "${file.name}" to ticket ${ticketNumber}: ${err instanceof Error ? err.message : err}`);
        });
      }
    })
    .catch((err) => {
      console.error(`[teamSupport] failed to sync update to ticket ${ticketNumber}: ${err instanceof Error ? err.message : err}`);
    });
}

// IDs for tickets the APM creates, captured from TeamSupport's own property lists (Harris
// Computer's NA2 instance) on 2026-10-21: ticket type "PS Projects", its "Not Started" status
// (statuses belong to a ticket type, so these two must stay a matching pair), and severity
// "Normal". If TeamSupport admins rename or replace any of them, update here.
const NEW_TICKET_TYPE_ID = "28879";
const NEW_TICKET_STATUS_ID = "172708";
const NEW_TICKET_SEVERITY_ID = "18224";

// The description is a ticket action with SystemActionTypeID 1 that TeamSupport creates empty
// along with the ticket — it can only be filled in with a second call after creation.
const DESCRIPTION_SYSTEM_ACTION_TYPE_ID = "1";

export interface CreateTicketResult {
  ticketNumber: string;
  // False when the ticket exists but its description couldn't be filled in — the ticket is
  // still usable, so callers should keep it and just tell the user.
  descriptionSet: boolean;
  // Same idea for the customer: false when one was asked for but couldn't be attached, null
  // when none was asked for.
  customerSet: boolean | null;
}

// The Group every ticket created from the TRIO software line goes to ("TRIO Support", not one
// of its L1/L2/SQL/Web lookalikes), captured from TeamSupport's group list 2026-10-22. Other
// lines have no default and leave the group blank.
const TRIO_SUPPORT_GROUP = { id: "30759", name: "TRIO Support" };

export function defaultTicketGroup(softwareLineName: string): { id: string; name: string } | null {
  return /^trio$/i.test(softwareLineName.trim()) ? TRIO_SUPPORT_GROUP : null;
}

// The choices in TeamSupport's custom "Nature" dropdown on tickets. There is no API for a
// custom field's options, so this is every value found on the existing PS Projects tickets
// (2026-10-22), kept in alphabetical order so the dropdown is easy to scan — if TeamSupport
// admins add or rename an option, update here and keep it sorted.
// TeamSupport accepts any text for it without checking, so a stale list can only hide a new
// option, never break ticket creation.
export const TICKET_NATURES = [
  "Administration",
  "Assistance to PS",
  "Bug",
  "Client Involvement",
  "Consulting and Training",
  "Customer Relationship",
  "Data Conversion Issue",
  "Data Extraction Service",
  "Data Issue",
  "DeliveryPoint Installation",
  "Discovery and Testing",
  "Enhancement",
  "Gov Window Implementation/Support",
  "Hardware/Network Issue",
  "Hosting Installation",
  "Implementation",
  "Installation/Configuration",
  "LAN Installation",
  "Non-Billable Time",
  "Other",
  "Performance Issue",
  "Post Go-Live Support",
  "Procedural",
  "Server Migration",
  "TCP Installation",
  "Training",
  "Training/Procedural",
  "Upgrade",
] as const;

export interface CreateTicketOptions {
  // A TeamSupport UserID, sent on a best-effort basis like postTicketAction's creatorId.
  assigneeUserId?: string | null;
  // A TeamSupport customer (organization) ID.
  customerId?: string | null;
  groupId?: string | null;
  productId?: string | null;
  nature?: string | null;
}

// Creates a ticket (POST Tickets), attaches the customer, and fills in its description.
export async function createTicket(
  name: string,
  description: string,
  options: CreateTicketOptions = {}
): Promise<CreateTicketResult> {
  const { assigneeUserId, customerId, groupId, productId, nature } = options;
  const ticket: Record<string, unknown> = {
    Name: name,
    TicketTypeID: NEW_TICKET_TYPE_ID,
    TicketStatusID: NEW_TICKET_STATUS_ID,
    TicketSeverityID: NEW_TICKET_SEVERITY_ID,
  };
  if (assigneeUserId) {
    ticket.UserID = assigneeUserId;
  }
  // Group, Product and the custom Nature field are all plain fields on the create call —
  // confirmed live 2026-10-22 (all three came back set on the new ticket).
  if (groupId) ticket.GroupID = groupId;
  if (productId) ticket.ProductID = productId;
  if (nature) ticket.Nature = nature;

  const raw = await teamSupportRequest("/api/json/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Ticket: ticket }),
  });
  const created = extractTicketPayload(raw);
  const ticketNumber = created?.TicketNumber != null ? String(created.TicketNumber) : null;
  if (!ticketNumber) {
    console.error(`[teamSupport] unrecognized response shape creating ticket: ${JSON.stringify(raw).slice(0, 500)}`);
    throw new TeamSupportUpstreamError("TeamSupport created the ticket but didn't say what its number is", null);
  }

  // Attaching a customer is its own call, and it takes the ticket's internal ID (TicketID),
  // not the ticket number. Confirmed live 2026-10-21: POST Tickets/{TicketID}/Customers/{customerId}
  // with an empty body links it; posting the customer in a body to Tickets/{TicketID}/Customers
  // returns 404, and setting it on the ticket itself via PUT is silently ignored.
  let customerSet: boolean | null = null;
  if (customerId) {
    try {
      const ticketId = created?.TicketID ?? created?.ID;
      if (ticketId == null) throw new Error("TeamSupport didn't say the ticket's internal ID");
      await teamSupportRequest(
        `/api/json/tickets/${encodeURIComponent(String(ticketId))}/customers/${encodeURIComponent(customerId)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      customerSet = true;
    } catch (err) {
      console.error(`[teamSupport] ticket ${ticketNumber} created but customer not attached: ${err instanceof Error ? err.message : err}`);
      customerSet = false;
    }
  }

  try {
    const actionsRaw = await teamSupportRequest(`/api/json/tickets/${encodeURIComponent(ticketNumber)}/actions`);
    const actions: Record<string, unknown>[] = Array.isArray(actionsRaw)
      ? actionsRaw
      : Array.isArray((actionsRaw as Record<string, unknown> | null)?.Actions)
        ? ((actionsRaw as Record<string, unknown>).Actions as Record<string, unknown>[])
        : [];
    const descriptionAction = actions.find((a) => String(a.SystemActionTypeID) === DESCRIPTION_SYSTEM_ACTION_TYPE_ID);
    const actionId = descriptionAction?.ActionID ?? descriptionAction?.ID;
    if (actionId == null) {
      throw new Error("couldn't find the ticket's description entry");
    }
    await teamSupportRequest(`/api/json/tickets/${encodeURIComponent(ticketNumber)}/actions/${encodeURIComponent(String(actionId))}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Plain text with real newlines: unlike posted actions, TeamSupport HTML-escapes a
      // ticket description on the way in (confirmed live, 2026-10-21 — a "<br>" came back as
      // literal "&lt;br&gt;"), so toHtmlLines would only add visible junk here.
      body: JSON.stringify({ Action: { Description: description } }),
    });
    return { ticketNumber, descriptionSet: true, customerSet };
  } catch (err) {
    console.error(`[teamSupport] ticket ${ticketNumber} created but description not set: ${err instanceof Error ? err.message : err}`);
    return { ticketNumber, descriptionSet: false, customerSet };
  }
}

export interface TeamSupportUser {
  id: string;
  name: string;
}

function extractUsersPayload(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.Users)) return obj.Users as Record<string, unknown>[];
  }
  return [];
}

// For the admin picker that maps an Aurora user to their TeamSupport counterpart, so admins
// don't have to hunt down a raw numeric UserID themselves.
export async function fetchTeamSupportUsers(): Promise<TeamSupportUser[]> {
  const raw = await teamSupportRequest("/api/json/users");
  return extractUsersPayload(raw)
    .map((row) => {
      const id = row.UserID ?? row.ID;
      const name = String(row.Name ?? [row.FirstName, row.LastName].filter(Boolean).join(" ")).trim();
      return id != null && name ? { id: String(id), name } : null;
    })
    .filter((u): u is TeamSupportUser => u !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface TeamSupportCustomer {
  id: string;
  name: string;
}

function extractCustomersPayload(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.Customers)) return obj.Customers as Record<string, unknown>[];
    // A single result comes back as an object rather than a one-item list.
    if (obj.Customers && typeof obj.Customers === "object") return [obj.Customers as Record<string, unknown>];
  }
  return [];
}

const CUSTOMER_PAGE_SIZE = 1000;
const MAX_CUSTOMER_PAGES = 20;

// TeamSupport's lookup lists (customers, products) are big, barely change, and every call
// counts against the daily quota — so each is kept in memory and shared by every user rather
// than re-read on each search. Once a list is older than maxAgeMs, the next request still gets
// the old copy instantly while a fresh one loads behind it, and the first read can be started
// at server startup (warm) so nobody waits for it.
function cachedList<T>(load: () => Promise<T[]>, maxAgeMs: number, label: string) {
  let cache: { at: number; items: T[] } | null = null;
  let inFlight: Promise<T[]> | null = null;

  function refresh(): Promise<T[]> {
    // Several people opening a picker at once share one read instead of each doing their own.
    inFlight ??= load()
      .then((items) => {
        cache = { at: Date.now(), items };
        return items;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    async get(): Promise<T[]> {
      if (!cache) return refresh();
      if (Date.now() - cache.at >= maxAgeMs) {
        refresh().catch((err) => {
          console.error(`[teamSupport] ${label} refresh failed: ${err instanceof Error ? err.message : err}`);
        });
      }
      return cache.items;
    },
    warm(): void {
      if (!process.env.TEAMSUPPORT_ORG_ID || !process.env.TEAMSUPPORT_API_TOKEN) return;
      refresh().catch((err) => {
        console.error(`[teamSupport] couldn't pre-load the ${label}: ${err instanceof Error ? err.message : err}`);
      });
    },
  };
}

const LIST_CACHE_MS = 6 * 60 * 60 * 1000;

// ~4,000 entries over 5 slow API calls (about 25 seconds in all).
async function loadAllCustomers(): Promise<TeamSupportCustomer[]> {
  const customers: TeamSupportCustomer[] = [];
  for (let page = 1; page <= MAX_CUSTOMER_PAGES; page++) {
    const raw = await teamSupportRequest(`/api/json/customers?PageSize=${CUSTOMER_PAGE_SIZE}&PageNumber=${page}`);
    const rows = extractCustomersPayload(raw);
    for (const row of rows) {
      const id = row.ID ?? row.OrganizationID;
      const name = String(row.Name ?? "").trim();
      // Inactive customers can't sensibly be put on a new ticket.
      if (id != null && name && String(row.IsActive).toLowerCase() !== "false") customers.push({ id: String(id), name });
    }
    if (rows.length < CUSTOMER_PAGE_SIZE) break;
  }
  return customers.sort((a, b) => a.name.localeCompare(b.name));
}

const customerList = cachedList(loadAllCustomers, LIST_CACHE_MS, "customer list");

// For the searchable Customer picker on projects.
export const fetchTeamSupportCustomers = customerList.get;

export interface TeamSupportProduct {
  id: string;
  name: string;
}

// TeamSupport returns names HTML-escaped ("Marshall &amp; Swift", "O&apos;Donnell").
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

// Every product across all of Harris's software lines (~830) comes back in a single call —
// and only when called with no paging parameters: PageSize/PageNumber make this endpoint
// return nothing at all (confirmed 2026-10-22).
async function loadAllProducts(): Promise<TeamSupportProduct[]> {
  const raw = await teamSupportRequest("/api/json/products");
  const rows =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).Products)
      ? ((raw as Record<string, unknown>).Products as Record<string, unknown>[])
      : [];
  const products: TeamSupportProduct[] = [];
  for (const row of rows) {
    const name = decodeEntities(String(row.Name ?? "").trim());
    // The list has a few unnamed rows and import leftovers ("#N/A").
    if (row.ID != null && name && name !== "#N/A") products.push({ id: String(row.ID), name });
  }
  return products.sort((a, b) => a.name.localeCompare(b.name));
}

const productList = cachedList(loadAllProducts, LIST_CACHE_MS, "product list");

// For the Product choice when creating a ticket.
export const fetchTeamSupportProducts = productList.get;

// Called once at startup so the first person to open a picker doesn't wait for the slow first
// read. Quietly does nothing when TeamSupport isn't configured.
export function warmTeamSupportLists(): void {
  customerList.warm();
  productList.warm();
}
