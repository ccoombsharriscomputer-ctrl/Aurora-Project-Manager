import { prisma } from "./prisma";
import { sendDigestEmails, taskUrl, projectUrl } from "./email";
import type { DigestFollowUpItem, DigestPayload, DigestTaskItem } from "./emailTemplates";

// This runs as a background job with no req.user, so effectiveSoftwareLineId doesn't apply —
// every query here is deliberately global (all lines), scoped only by correctness filters.

// A follow-up scan with no floor would, after any long outage, resurface every historical
// follow-up ever created the moment the job resumes. 14 days is generous slack for a missed
// run (deploy, restart) while still bounding the blast radius of a multi-week outage.
const FOLLOW_UP_LOOKBACK_DAYS = 14;

// Exported (alongside the query below) so a verification script can inspect exactly which
// tasks/follow-ups landed in which user's bucket, rather than only being able to observe
// aggregate counts from the outside.
export interface DigestQueryResult {
  overdueByUser: Map<string, DigestTaskItem[]>;
  dueTodayByUser: Map<string, DigestTaskItem[]>;
  dueNextBusinessDayByUser: Map<string, DigestTaskItem[]>;
  followUpsByUser: Map<string, DigestFollowUpItem[]>;
  followUpIdsToMark: string[];
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// The business day immediately before `date` — steps back one calendar day, then keeps
// stepping back over a weekend. A Monday due date's "day prior" reminder should land on the
// preceding Friday (the scheduler runs every day, weekends included, so nothing stops it —
// this is purely about which due dates count as "tomorrow" in business terms), not silently
// never fire because the literal day before was a Saturday or Sunday.
function previousBusinessDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
}

export async function queryDigestData(now: Date): Promise<DigestQueryResult> {
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const lookbackFloor = new Date(startOfToday.getTime() - FOLLOW_UP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // Widest a due date can sit from today and still have today as its business-day-prior: a
  // due date of today+3 (a Monday, when today is Friday). Anything due today+4 or later can
  // never map back to today, so this is a safe upper bound for the query itself — the exact
  // per-task match is still checked below.
  const dueSoonWindowEnd = new Date(startOfToday.getTime() + 4 * 24 * 60 * 60 * 1000);

  const overdueByUser = new Map<string, DigestTaskItem[]>();
  const dueTodayByUser = new Map<string, DigestTaskItem[]>();
  const dueNextBusinessDayByUser = new Map<string, DigestTaskItem[]>();
  const followUpsByUser = new Map<string, DigestFollowUpItem[]>();

  // Tasks — deliberately diverges from the admin-only /api/reports/overdue query in two ways:
  // drops its "completed late" retrospective branch (nobody should be emailed about a task
  // they already finished), and excludes archived projects (that report doesn't, but
  // calendar.ts already does — matching the more correct precedent).
  const tasks = await prisma.task.findMany({
    where: {
      dueDate: { not: null, lt: dueSoonWindowEnd },
      status: { notIn: ["DONE", "NA"] },
      project: { archivedAt: null },
      assignee: { active: true, emailNotifications: true },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      project: { select: { name: true } },
      subProject: { select: { name: true, checklistItem: { select: { name: true } } } },
      assigneeId: true,
    },
  });

  for (const task of tasks) {
    const dueDate = task.dueDate!;
    const item: DigestTaskItem = {
      title: task.title,
      projectName: task.project.name,
      subProjectName: task.subProject.name || task.subProject.checklistItem.name,
      dueDate,
      url: taskUrl(task.id),
    };
    if (dueDate < startOfToday) {
      pushTo(overdueByUser, task.assigneeId!, item);
    } else if (dueDate < startOfTomorrow) {
      pushTo(dueTodayByUser, task.assigneeId!, item);
    } else if (previousBusinessDay(dueDate).getTime() === startOfToday.getTime()) {
      pushTo(dueNextBusinessDayByUser, task.assigneeId!, item);
    }
    // Anything else in the window (e.g. a Saturday due date on a Wednesday) isn't today's
    // business-day-prior match and is simply skipped — it'll be picked up on its own day.
  }

  // Follow-ups — not excluding those on already-DONE tasks: excluding them would leave those
  // rows permanently unmarked (remindedAt never set) and stuck in the scan set forever.
  // Instead they're included with the task's status shown, which is legitimately useful
  // ("check back on this — already Done") rather than noise. Completed follow-ups (the
  // person handled it themselves, from the project page or the calendar) are excluded
  // outright — there's nothing left to remind anyone about.
  const followUps = await prisma.followUp.findMany({
    where: {
      remindedAt: null,
      completedAt: null,
      dueDate: { gte: lookbackFloor, lt: startOfTomorrow },
      user: { active: true, emailNotifications: true },
      OR: [{ task: { project: { archivedAt: null } } }, { project: { archivedAt: null } }],
    },
    select: {
      id: true,
      dueDate: true,
      userId: true,
      task: { select: { id: true, title: true, status: true, project: { select: { name: true } } } },
      project: { select: { id: true, name: true } },
    },
  });

  const followUpIdsToMark: string[] = [];
  for (const followUp of followUps) {
    followUpIdsToMark.push(followUp.id);
    if (followUp.task) {
      pushTo(followUpsByUser, followUp.userId, {
        title: followUp.task.title,
        projectName: followUp.task.project.name,
        taskStatus: followUp.task.status,
        dueDate: followUp.dueDate,
        url: taskUrl(followUp.task.id),
      });
    } else if (followUp.project) {
      pushTo(followUpsByUser, followUp.userId, {
        title: null,
        projectName: followUp.project.name,
        taskStatus: null,
        dueDate: followUp.dueDate,
        url: projectUrl(followUp.project.id),
      });
    }
  }

  return { overdueByUser, dueTodayByUser, dueNextBusinessDayByUser, followUpsByUser, followUpIdsToMark };
}

export interface DigestRunSummary {
  usersEmailed: number;
  overdueTaskCount: number;
  dueTodayTaskCount: number;
  dueNextBusinessDayTaskCount: number;
  followUpCount: number;
  dryRun: boolean;
}

// The actual work behind both the scheduled job and the on-demand admin routes. dryRun skips
// both the send and the remindedAt mutation, so local testing stays repeatable — running it
// twice in dry-run mode produces byte-identical output.
export async function runDailyNotifications(options: { dryRun?: boolean } = {}): Promise<DigestRunSummary> {
  const dryRun = options.dryRun ?? false;
  const now = new Date();
  const { overdueByUser, dueTodayByUser, dueNextBusinessDayByUser, followUpsByUser, followUpIdsToMark } =
    await queryDigestData(now);

  const userIds = new Set<string>([
    ...overdueByUser.keys(),
    ...dueTodayByUser.keys(),
    ...dueNextBusinessDayByUser.keys(),
    ...followUpsByUser.keys(),
  ]);
  let overdueTaskCount = 0;
  let dueTodayTaskCount = 0;
  let dueNextBusinessDayTaskCount = 0;
  let followUpCount = 0;

  if (userIds.size > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, name: true, email: true, locale: true },
    });

    const payloads: ({ to: string } & DigestPayload)[] = users.map((user) => {
      const overdueTasks = overdueByUser.get(user.id) ?? [];
      const dueTodayTasks = dueTodayByUser.get(user.id) ?? [];
      const dueNextBusinessDayTasks = dueNextBusinessDayByUser.get(user.id) ?? [];
      const followUps = followUpsByUser.get(user.id) ?? [];
      overdueTaskCount += overdueTasks.length;
      dueTodayTaskCount += dueTodayTasks.length;
      dueNextBusinessDayTaskCount += dueNextBusinessDayTasks.length;
      followUpCount += followUps.length;
      return {
        to: user.email,
        locale: user.locale,
        userName: user.name,
        overdueTasks,
        dueTodayTasks,
        dueNextBusinessDayTasks,
        followUps,
      };
    });

    if (!dryRun) {
      // Sent, then marked — an at-least-once guarantee. If Resend errors mid-batch, the
      // follow-ups involved stay unmarked and get retried on the next run rather than
      // silently disappearing.
      await sendDigestEmails(payloads);
      if (followUpIdsToMark.length > 0) {
        await prisma.followUp.updateMany({ where: { id: { in: followUpIdsToMark } }, data: { remindedAt: now } });
      }
    }
  }

  const summary: DigestRunSummary = {
    usersEmailed: userIds.size,
    overdueTaskCount,
    dueTodayTaskCount,
    dueNextBusinessDayTaskCount,
    followUpCount,
    dryRun,
  };

  console.log(
    `[notifications] digest run${dryRun ? " (dry run)" : ""}: ${summary.usersEmailed} users, ` +
      `${summary.overdueTaskCount + summary.dueTodayTaskCount + summary.dueNextBusinessDayTaskCount} tasks ` +
      `(${summary.overdueTaskCount} overdue, ${summary.dueTodayTaskCount} due today, ` +
      `${summary.dueNextBusinessDayTaskCount} due next business day), ` +
      `${summary.followUpCount} follow-ups`
  );

  return summary;
}
