import { prisma } from "./prisma";
import { projectUrl, taskUrl } from "./email";

// Puts a task on the Aurora Calendar (a separate app) on its due date. Only runs when both
// settings exist; the key is the same value as APM_API_KEY in the calendar's settings.
const baseUrl = (process.env.CALENDAR_API_URL || "").replace(/\/$/, "");
const apiKey = process.env.CALENDAR_API_KEY || "";

export const calendarIsConfigured = Boolean(baseUrl && apiKey);

async function call(method: "PUT" | "DELETE", taskId: string, body?: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/api/apm/events/${encodeURIComponent(taskId)}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => (j as { error?: string }).error).catch(() => undefined);
    throw new Error(detail || `Calendar answered HTTP ${res.status}`);
  }
}

// Creates or updates the task's calendar event from the task as it is now. A task that's lost its
// assignee or due date can't be on the calendar, so it comes off instead (and onCalendar clears).
export async function syncTaskToCalendar(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { select: { name: true, email: true } },
      createdBy: { select: { email: true } },
      project: { select: { id: true, name: true, softwareLine: { select: { name: true } } } },
    },
  });
  if (!task) return;
  if (!task.assignee || !task.dueDate) {
    await removeTaskFromCalendar(taskId);
    await prisma.task.update({ where: { id: taskId }, data: { onCalendar: false } });
    return;
  }
  await call("PUT", taskId, {
    title: task.title,
    notes: [`Assigned to ${task.assignee.name}`, `Project: ${task.project.name}`, `Task: ${taskUrl(task.id)}`, `Project page: ${projectUrl(task.project.id)}`].join("\n"),
    date: task.dueDate.toISOString().slice(0, 10),
    lineName: task.project.softwareLine.name,
    assigneeEmail: task.assignee.email,
    createdByEmail: task.createdBy.email,
  });
}

export async function removeTaskFromCalendar(taskId: string): Promise<void> {
  if (!calendarIsConfigured) return;
  await call("DELETE", taskId);
}

// Wraps a sync so a calendar problem never fails saving the task: returns a short message to show
// the person, or null when it worked.
export async function trySync(taskId: string): Promise<string | null> {
  if (!calendarIsConfigured) return "The calendar link isn't set up yet — ask an admin to add CALENDAR_API_URL and CALENDAR_API_KEY.";
  try {
    await syncTaskToCalendar(taskId);
    return null;
  } catch (err) {
    console.error(`[calendar] sync failed for task ${taskId}:`, err);
    return `The task was saved, but adding it to the Aurora Calendar failed: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}
