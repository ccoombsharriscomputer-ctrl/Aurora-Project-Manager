import { Resend } from "resend";
import { prisma } from "./prisma";
import { renderAccessRequestEmail, renderDigestEmail, type DigestPayload } from "./emailTemplates";

interface AccessRequestNotification {
  name: string;
  email: string;
  message: string | null;
  softwareLineId: string;
}

export interface OutgoingEmail {
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

// Mirrors lib/storage.ts's pattern: pick the implementation once at module load rather than
// branching per call. Without RESEND_API_KEY/EMAIL_FROM set, every send just logs — identical
// to this file's original stub behavior — so the whole feature is safe to deploy before
// Resend is even set up.
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

function logInsteadOfSending(email: OutgoingEmail): void {
  console.log(`[email] (not configured — would send) to=${email.to} subject="${email.subject}"`);
}

// Resend rate-limits to 2 req/s, but resend.batch.send() posts up to 100 messages in a
// single call — a digest fanning out to N users is 1 API call instead of N. Chunked at 100
// since that's the API's own hard limit per batch request.
const BATCH_SIZE = 100;

async function sendAll(emails: OutgoingEmail[]): Promise<void> {
  if (emails.length === 0) return;

  if (!resend || !emailFrom) {
    emails.forEach(logInsteadOfSending);
    return;
  }

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const chunk = emails.slice(i, i + BATCH_SIZE);
    const { error } = await resend.batch.send(
      chunk.map((email) => ({
        from: emailFrom,
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }))
    );
    if (error) {
      throw new Error(`Resend batch send failed: ${error.message}`);
    }
  }
}

// Recipients are every active admin whose accessRequestNotifyAllLines is true, plus any
// admin who's explicitly subscribed to this request's specific software line — lets one
// admin (typically whoever's setting this up) stay on every request regardless of line,
// while others are scoped to just the lines they care about. Grouped by locale so each
// group gets one message in their own language; replyTo is the requester's own address so an
// admin can just hit Reply instead of copying it out of the message body.
export async function notifyAdminsOfAccessRequest(request: AccessRequestNotification): Promise<void> {
  const admins = await prisma.user.findMany({
    where: {
      role: "ADMIN",
      active: true,
      OR: [
        { accessRequestNotifyAllLines: true },
        { accessRequestLineSubscriptions: { some: { softwareLineId: request.softwareLineId } } },
      ],
    },
    select: { email: true, locale: true },
  });

  if (admins.length === 0) {
    console.log(
      `[access request] ${request.name} <${request.email}> requested access — no active admins to notify` +
        (request.message ? ` — "${request.message}"` : "")
    );
    return;
  }

  const emails = admins.map((admin) => {
    const rendered = renderAccessRequestEmail(admin.locale, request);
    return { to: admin.email, replyTo: request.email, ...rendered };
  });

  await sendAll(emails);
}

// One digest email per user (never one per task/follow-up) — see lib/notifications.ts for
// how the payload is built.
export async function sendDigestEmails(payloads: ({ to: string } & DigestPayload)[]): Promise<void> {
  const emails = payloads.map((payload) => ({
    to: payload.to,
    ...renderDigestEmail(payload),
  }));
  await sendAll(emails);
}

// Used by the admin "send me a test email" route — bypasses the digest-building logic
// entirely so it's a pure send-path smoke test.
export async function sendTestEmail(to: string): Promise<void> {
  await sendAll([
    {
      to,
      subject: "Aurora Project Manager — test email",
      html: "<p>This is a test email from Aurora Project Manager. If you received this, outbound email is working.</p>",
      text: "This is a test email from Aurora Project Manager. If you received this, outbound email is working.",
    },
  ]);
}

export const emailIsConfigured = Boolean(resend && emailFrom);
