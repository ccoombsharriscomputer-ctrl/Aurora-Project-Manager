import type { Locale } from "@prisma/client";

// Pure content builders — no I/O, no Prisma calls — mirroring how lib/contractExtraction.ts
// is kept separate from the route that uses it. Localized via a plain string table rather
// than i18next: that's a filesystem-backed system built for the client, and wiring it up
// server-side for the ~15 strings here would be disproportionate. `user.locale` is already
// loaded on every relevant row, so this just switches on it directly.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface AccessRequestContent {
  name: string;
  email: string;
  message: string | null;
}

export interface DigestTaskItem {
  title: string;
  projectName: string;
  subProjectName: string;
  dueDate: Date;
  url: string;
}

export interface DigestFollowUpItem {
  // Null for a project-level follow-up (no task at all) — the template falls back to a
  // generic label in that case. taskStatus is null for the same reason: no task, no status.
  title: string | null;
  projectName: string;
  taskStatus: string | null;
  dueDate: Date;
  url: string;
}

export interface DigestPayload {
  locale: Locale;
  userName: string;
  overdueTasks: DigestTaskItem[];
  dueTodayTasks: DigestTaskItem[];
  followUps: DigestFollowUpItem[];
}

// `Task.dueDate`/`FollowUp.dueDate` are stored as UTC midnight (see DeadlinesCalendar.tsx's
// own comment on this) — formatting without an explicit UTC timeZone would let a
// negative-offset reader (e.g. US/Canada) see the previous day.
const INTL_LOCALE: Record<Locale, string> = { EN: "en-US", ES: "es", FR_CA: "fr-CA" };

function formatDueDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Minimal shared chrome — a single-column table-free layout that renders reasonably in every
// major mail client without pulling in a templating library for a handful of emails.
function wrapHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2430;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      ${bodyHtml}
      <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e4e6ea;font-size:12px;color:#8a8f98;">
        Aurora Project Manager
      </p>
    </div>
  </body>
</html>`;
}

const ACCESS_REQUEST_STRINGS: Record<Locale, { subject: string; heading: (name: string) => string; from: string; message: string; noMessage: string }> = {
  EN: {
    subject: "New access request — Aurora Project Manager",
    heading: (name) => `New access request from ${name}`,
    from: "Email",
    message: "Message",
    noMessage: "No message was included.",
  },
  ES: {
    subject: "Nueva solicitud de acceso — Aurora Project Manager",
    heading: (name) => `Nueva solicitud de acceso de ${name}`,
    from: "Correo electrónico",
    message: "Mensaje",
    noMessage: "No se incluyó ningún mensaje.",
  },
  FR_CA: {
    subject: "Nouvelle demande d'accès — Aurora Project Manager",
    heading: (name) => `Nouvelle demande d'accès de ${name}`,
    from: "Courriel",
    message: "Message",
    noMessage: "Aucun message n'a été inclus.",
  },
};

export function renderAccessRequestEmail(locale: Locale, request: AccessRequestContent): RenderedEmail {
  const s = ACCESS_REQUEST_STRINGS[locale];
  const message = request.message ? escapeHtml(request.message) : `<em>${s.noMessage}</em>`;
  const html = wrapHtml(`
    <h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(s.heading(request.name))}</h2>
    <p style="margin:0 0 8px;"><strong>${s.from}:</strong> ${escapeHtml(request.email)}</p>
    <p style="margin:16px 0 0;"><strong>${s.message}:</strong></p>
    <p style="margin:4px 0 0;white-space:pre-wrap;">${message}</p>
  `);
  const text = [
    s.heading(request.name),
    `${s.from}: ${request.email}`,
    `${s.message}: ${request.message || s.noMessage}`,
  ].join("\n");
  return { subject: s.subject, html, text };
}

const DIGEST_STRINGS: Record<
  Locale,
  {
    subjectOne: string;
    subjectMany: string;
    greeting: (name: string) => string;
    overdue: string;
    dueToday: string;
    followUps: string;
    project: string;
    due: string;
    status: string;
    followUpGenericLabel: string;
  }
> = {
  EN: {
    subjectOne: "1 item needs your attention — Aurora Project Manager",
    subjectMany: "items need your attention — Aurora Project Manager",
    greeting: (name) => `Hi ${name},`,
    overdue: "Overdue tasks",
    dueToday: "Due today",
    followUps: "Follow-ups due",
    project: "Project",
    due: "Due",
    status: "Status",
    followUpGenericLabel: "This project",
  },
  ES: {
    subjectOne: "1 elemento requiere su atención — Aurora Project Manager",
    subjectMany: "elementos requieren su atención — Aurora Project Manager",
    greeting: (name) => `Hola ${name},`,
    overdue: "Tareas atrasadas",
    dueToday: "Vencen hoy",
    followUps: "Seguimientos pendientes",
    project: "Proyecto",
    due: "Vence",
    status: "Estado",
    followUpGenericLabel: "Este proyecto",
  },
  FR_CA: {
    subjectOne: "1 élément nécessite votre attention — Aurora Project Manager",
    subjectMany: "éléments nécessitent votre attention — Aurora Project Manager",
    greeting: (name) => `Bonjour ${name},`,
    overdue: "Tâches en retard",
    dueToday: "À échéance aujourd'hui",
    followUps: "Suivis à effectuer",
    project: "Projet",
    due: "Échéance",
    status: "Statut",
    followUpGenericLabel: "Ce projet",
  },
};

function taskRowsHtml(tasks: DigestTaskItem[], locale: Locale): string {
  return tasks
    .map(
      (t) =>
        `<li style="margin:0 0 8px;"><a href="${t.url}" style="color:#3457d5;">${escapeHtml(t.title)}</a> — ${escapeHtml(
          t.projectName
        )} / ${escapeHtml(t.subProjectName)} (${formatDueDate(t.dueDate, locale)})</li>`
    )
    .join("");
}

function followUpRowsHtml(followUps: DigestFollowUpItem[], locale: Locale, s: (typeof DIGEST_STRINGS)["EN"]): string {
  return followUps
    .map((f) => {
      const label = f.title ?? s.followUpGenericLabel;
      const statusSuffix = f.taskStatus ? ` — ${s.status}: ${escapeHtml(f.taskStatus)}` : "";
      return `<li style="margin:0 0 8px;"><a href="${f.url}" style="color:#3457d5;">${escapeHtml(label)}</a> — ${escapeHtml(
        f.projectName
      )} (${formatDueDate(f.dueDate, locale)})${statusSuffix}</li>`;
    })
    .join("");
}

export function renderDigestEmail(payload: DigestPayload): RenderedEmail {
  const { locale, userName, overdueTasks, dueTodayTasks, followUps } = payload;
  const s = DIGEST_STRINGS[locale];
  const total = overdueTasks.length + dueTodayTasks.length + followUps.length;
  const subject = total === 1 ? s.subjectOne : `${total} ${s.subjectMany}`;

  const sections: string[] = [];
  const textSections: string[] = [];

  if (overdueTasks.length > 0) {
    sections.push(`<h3 style="margin:24px 0 8px;font-size:15px;color:#c0392b;">${s.overdue}</h3><ul style="margin:0;padding-left:20px;">${taskRowsHtml(overdueTasks, locale)}</ul>`);
    textSections.push(`${s.overdue}:\n${overdueTasks.map((t) => `- ${t.title} (${t.projectName} / ${t.subProjectName}, ${formatDueDate(t.dueDate, locale)}) ${t.url}`).join("\n")}`);
  }
  if (dueTodayTasks.length > 0) {
    sections.push(`<h3 style="margin:24px 0 8px;font-size:15px;color:#b8860b;">${s.dueToday}</h3><ul style="margin:0;padding-left:20px;">${taskRowsHtml(dueTodayTasks, locale)}</ul>`);
    textSections.push(`${s.dueToday}:\n${dueTodayTasks.map((t) => `- ${t.title} (${t.projectName} / ${t.subProjectName}, ${formatDueDate(t.dueDate, locale)}) ${t.url}`).join("\n")}`);
  }
  if (followUps.length > 0) {
    sections.push(`<h3 style="margin:24px 0 8px;font-size:15px;color:#2c5aa0;">${s.followUps}</h3><ul style="margin:0;padding-left:20px;">${followUpRowsHtml(followUps, locale, s)}</ul>`);
    textSections.push(
      `${s.followUps}:\n${followUps
        .map((f) => {
          const label = f.title ?? s.followUpGenericLabel;
          const statusSuffix = f.taskStatus ? `, ${s.status}: ${f.taskStatus}` : "";
          return `- ${label} (${f.projectName}, ${formatDueDate(f.dueDate, locale)}${statusSuffix}) ${f.url}`;
        })
        .join("\n")}`
    );
  }

  const html = wrapHtml(`
    <p style="margin:0 0 16px;">${escapeHtml(s.greeting(userName))}</p>
    ${sections.join("")}
  `);
  const text = [s.greeting(userName), "", ...textSections].join("\n\n");

  return { subject, html, text };
}

export interface TaskAssignedContent {
  taskTitle: string;
  projectName: string;
  subProjectName: string;
  dueDate: Date;
  url: string;
}

const TASK_ASSIGNED_STRINGS: Record<Locale, { subject: string; heading: string; project: string; due: string }> = {
  EN: {
    subject: "You've been assigned a task — Aurora Project Manager",
    heading: "You've been assigned a task",
    project: "Project",
    due: "Due",
  },
  ES: {
    subject: "Se le ha asignado una tarea — Aurora Project Manager",
    heading: "Se le ha asignado una tarea",
    project: "Proyecto",
    due: "Vence",
  },
  FR_CA: {
    subject: "Une tâche vous a été assignée — Aurora Project Manager",
    heading: "Une tâche vous a été assignée",
    project: "Projet",
    due: "Échéance",
  },
};

export function renderTaskAssignedEmail(locale: Locale, content: TaskAssignedContent): RenderedEmail {
  const s = TASK_ASSIGNED_STRINGS[locale];
  const html = wrapHtml(`
    <h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(s.heading)}</h2>
    <p style="margin:0 0 8px;"><a href="${content.url}" style="color:#3457d5;font-weight:600;">${escapeHtml(content.taskTitle)}</a></p>
    <p style="margin:0 0 4px;color:#5b6670;">${s.project}: ${escapeHtml(content.projectName)} / ${escapeHtml(content.subProjectName)}</p>
    <p style="margin:0;color:#5b6670;">${s.due}: ${formatDueDate(content.dueDate, locale)}</p>
  `);
  const text = [
    s.heading,
    content.taskTitle,
    `${s.project}: ${content.projectName} / ${content.subProjectName}`,
    `${s.due}: ${formatDueDate(content.dueDate, locale)}`,
    content.url,
  ].join("\n");
  return { subject: s.subject, html, text };
}
