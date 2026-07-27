const TEAMSUPPORT_BASE_URL = "https://app.teamsupport.com";

export class TeamSupportNotConfiguredError extends Error {}
export class TeamSupportTicketNotFoundError extends Error {}

// Carries the upstream HTTP status (or a network-level failure reason when there was no
// response at all) so the route handler can return a diagnostic-enough message without
// needing production log access to tell "wrong credentials" apart from "can't connect".
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
  url: string;
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

function ticketUrl(ticketNumber: string): string {
  const template = process.env.TEAMSUPPORT_TICKET_URL_TEMPLATE || `${TEAMSUPPORT_BASE_URL}/vcr/1_7_0/Pages/Ticket.html?TicketNumber={ticketNumber}`;
  return template.replace("{ticketNumber}", encodeURIComponent(ticketNumber));
}

export async function fetchTicketByNumber(ticketNumber: string): Promise<TeamSupportTicket> {
  const orgId = process.env.TEAMSUPPORT_ORG_ID;
  const apiToken = process.env.TEAMSUPPORT_API_TOKEN;
  if (!orgId || !apiToken) {
    throw new TeamSupportNotConfiguredError("TeamSupport is not configured");
  }

  const auth = Buffer.from(`${orgId}:${apiToken}`).toString("base64");
  const url = `${TEAMSUPPORT_BASE_URL}/api/json/tickets/${encodeURIComponent(ticketNumber)}.json`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[teamSupport] network error calling ${url}: ${message}`);
    throw new TeamSupportUpstreamError(`Network error reaching TeamSupport: ${message}`, null);
  }

  if (response.status === 404) {
    throw new TeamSupportTicketNotFoundError(`Ticket ${ticketNumber} not found`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[teamSupport] ${url} returned HTTP ${response.status}: ${body.slice(0, 500)}`);
    throw new TeamSupportUpstreamError(`TeamSupport returned HTTP ${response.status}`, response.status);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[teamSupport] failed to parse JSON from ${url}: ${message}`);
    throw new TeamSupportUpstreamError(`TeamSupport returned a response that wasn't valid JSON`, response.status);
  }

  const payload = extractTicketPayload(raw);
  if (!payload) {
    console.error(`[teamSupport] unrecognized response shape from ${url}: ${JSON.stringify(raw).slice(0, 500)}`);
    throw new TeamSupportTicketNotFoundError(`Ticket ${ticketNumber} not found`);
  }

  return {
    ticketNumber: String(payload.TicketNumber ?? ticketNumber),
    name: String(payload.Name ?? ""),
    status: String(payload.Status ?? "Unknown"),
    severity: payload.Severity ? String(payload.Severity) : null,
    groupName: payload.GroupName ? String(payload.GroupName) : null,
    assigneeName: payload.UserName ? String(payload.UserName) : null,
    url: ticketUrl(ticketNumber),
  };
}
