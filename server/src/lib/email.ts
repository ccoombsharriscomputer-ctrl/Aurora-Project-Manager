interface AccessRequestNotification {
  name: string;
  email: string;
  message: string | null;
}

// TODO: wire a real email provider (e.g. Resend) here. For now this just logs so the
// call site and data shape are already in place once credentials are available.
export async function notifyAdminsOfAccessRequest(request: AccessRequestNotification): Promise<void> {
  console.log(
    `[access request] ${request.name} <${request.email}> requested access` +
      (request.message ? ` — "${request.message}"` : "")
  );
}
