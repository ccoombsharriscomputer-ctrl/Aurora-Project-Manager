const TEAMSUPPORT_BASE_URL = "https://app.teamsupport.com";

export class TeamSupportNotConfiguredError extends Error {}
export class TeamSupportTicketNotFoundError extends Error {}

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
  const response = await fetch(`${TEAMSUPPORT_BASE_URL}/api/json/tickets/${encodeURIComponent(ticketNumber)}.json`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });

  if (response.status === 404) {
    throw new TeamSupportTicketNotFoundError(`Ticket ${ticketNumber} not found`);
  }
  if (!response.ok) {
    throw new Error(`TeamSupport API error: ${response.status}`);
  }

  const payload = extractTicketPayload(await response.json());
  if (!payload) {
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
