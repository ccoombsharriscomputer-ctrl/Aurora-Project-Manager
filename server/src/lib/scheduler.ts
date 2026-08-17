import { prisma } from "./prisma";
import { runDailyNotifications } from "./notifications";

// The first background/scheduled job of any kind in this codebase. No library (node-cron
// doesn't survive a process restart, so the real correctness mechanism — the atomic JobRun
// claim below — is needed regardless; a library would just be syntax sugar on top of it).
//
// ⚠️ Operational risk: an in-process timer only fires while the process is alive, and Azure
// App Service unloads an idle app after ~20 minutes unless "Always On" is enabled (App
// Service "APM" → Configuration → General settings). If it's off, the failure mode is
// silent — no error, just no email, ever.

const JOB_NAME = "daily-digest";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;

function digestEnabled(): boolean {
  return process.env.NOTIFICATIONS_DIGEST_ENABLED !== "false";
}

function dailyHourUtc(): number {
  const configured = Number(process.env.NOTIFICATIONS_DAILY_HOUR_UTC);
  return Number.isInteger(configured) && configured >= 0 && configured <= 23 ? configured : 13;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Atomically claims today's run via a row-locked updateMany — Postgres guarantees exactly one
// caller ever sees count === 1 for a given day, which is correct across restarts (a deploy
// mid-window can't double-fire) and across instances for free, should the App Service ever
// scale out.
async function tryClaimToday(): Promise<boolean> {
  const today = startOfUtcDay(new Date());
  const result = await prisma.jobRun.updateMany({
    where: { name: JOB_NAME, lastRunOn: { lt: today } },
    data: { lastRunOn: today },
  });
  return result.count === 1;
}

async function tick(): Promise<void> {
  if (!digestEnabled()) return;
  if (new Date().getUTCHours() < dailyHourUtc()) return;

  const claimed = await tryClaimToday().catch((err) => {
    console.error("[scheduler] failed to claim daily-digest run:", err instanceof Error ? err.message : err);
    return false;
  });
  if (!claimed) return;

  await runDailyNotifications().catch((err) => {
    console.error("[scheduler] daily-digest run failed:", err instanceof Error ? err.message : err);
  });
}

// Called from index.ts inside the server.listen callback (not before), so this upsert can't
// delay binding the port Azure health-checks. Seeded at epoch so the very first claim isn't a
// no-op against a missing row.
export async function startScheduler(): Promise<void> {
  await prisma.jobRun.upsert({
    where: { name: JOB_NAME },
    create: { name: JOB_NAME, lastRunOn: new Date(0) },
    update: {},
  });

  setTimeout(() => void tick(), INITIAL_DELAY_MS);
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
}
