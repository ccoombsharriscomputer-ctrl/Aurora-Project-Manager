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
): Promise<void> {
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

  await teamSupportRequest(`/api/json/tickets/${encodeURIComponent(ticketNumber)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Action: action }),
  });
}

// TeamSupport renders Action descriptions as HTML, so a plain "\n" collapses away like any
// other whitespace in a browser — real line breaks need <br> tags instead.
function toHtmlLines(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

// Fire-and-forget: a comment or time log in Aurora should never fail (or wait) on
// TeamSupport being slow or unreachable, so this is deliberately not awaited by callers.
// The header names the specific software line's Project Manager (e.g. "Via TRIO Project
// Manager") rather than "Aurora" generically, since that's what actually means something to
// whoever reads the note in TeamSupport.
export function syncTaskUpdateToTeamSupport(
  ticketNumber: string,
  body: string,
  productLineName: string,
  options: PostTicketActionOptions = {}
) {
  const description = `Via ${productLineName} Project Manager<br><br><br>${toHtmlLines(body)}`;
  postTicketAction(ticketNumber, description, options).catch((err) => {
    console.error(`[teamSupport] failed to sync update to ticket ${ticketNumber}: ${err instanceof Error ? err.message : err}`);
  });
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
