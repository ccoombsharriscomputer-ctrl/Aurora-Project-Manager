export interface DateRange {
  from?: Date;
  to?: Date;
}

interface TaskLite {
  status: string;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

interface TimeEntryLite {
  durationMinutes: number | null;
  startedAt: Date;
}

function inRange(date: Date, range: DateRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

// "Done" tasks are scoped to the date range (via completedAt); "open" tasks reflect
// live current state and are never filtered by date, since they have no completion event yet.
export function computeTaskStats(tasks: TaskLite[], range: DateRange) {
  const now = new Date();
  const hasRange = Boolean(range.from || range.to);
  const open = tasks.filter((t) => t.status !== "DONE");
  const done = tasks.filter((t) => t.status === "DONE" && t.completedAt);
  const doneInRange = hasRange ? done.filter((t) => inRange(t.completedAt!, range)) : done;

  const overdueOpen = open.filter((t) => t.dueDate && t.dueDate < now).length;
  const completedLate = doneInRange.filter((t) => t.dueDate && t.completedAt! > t.dueDate).length;
  const completedOnTime = doneInRange.length - completedLate;
  const onTimeRate = doneInRange.length > 0 ? Math.round((completedOnTime / doneInRange.length) * 1000) / 10 : null;

  const durations = doneInRange.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / 86_400_000);
  const avgCompletionDays =
    durations.length > 0 ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;

  return {
    totalTasks: tasks.length,
    openTasks: open.length,
    doneTasks: doneInRange.length,
    overdueOpen,
    completedLate,
    onTimeRate,
    avgCompletionDays,
  };
}

export function sumHours(entries: TimeEntryLite[], range: DateRange): number {
  const hasRange = Boolean(range.from || range.to);
  const filtered = hasRange ? entries.filter((e) => inRange(e.startedAt, range)) : entries;
  const totalMinutes = filtered.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  return Math.round((totalMinutes / 60) * 10) / 10;
}
