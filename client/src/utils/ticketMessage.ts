import type { TFunction } from "i18next";

// What to tell the user after a TeamSupport ticket was created: the ticket always exists by
// then, but its description and customer are separate calls that can each have failed.
export function ticketCreatedMessage(
  t: TFunction,
  result: { ticketNumber: string; descriptionSet: boolean; customerSet: boolean | null }
): { text: string; isError: boolean } {
  const customerFailed = result.customerSet === false;
  const key =
    !result.descriptionSet && customerFailed
      ? "projectDetail.teamSupportTicketCreatedNoDescriptionOrCustomer"
      : !result.descriptionSet
        ? "projectDetail.teamSupportTicketCreatedNoDescription"
        : customerFailed
          ? "projectDetail.teamSupportTicketCreatedNoCustomer"
          : "projectDetail.teamSupportTicketCreated";
  return { text: t(key, { number: result.ticketNumber }), isError: key !== "projectDetail.teamSupportTicketCreated" };
}
