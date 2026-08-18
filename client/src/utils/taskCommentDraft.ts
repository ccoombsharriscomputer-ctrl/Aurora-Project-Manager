// Switching between the app's own open tabs (see OpenTabsContext) navigates to a different
// route, which unmounts TaskDetailPage entirely — the comment form's state is local to that
// component, so without this, anything typed but not yet posted was silently lost the moment
// you switched away and back. Drafts are saved per task, restored on return, and cleared once
// the comment actually posts (or once it's typed back down to nothing).

export const TASK_COMMENT_DRAFT_STORAGE_KEY = "aurora-task-comment-drafts";

export interface TaskCommentDraft {
  body: string;
  date: string;
  hours: string;
  actionTypeId: string;
  isPublic: boolean;
  followUpDate: string;
}

function loadAllDrafts(): Record<string, TaskCommentDraft> {
  try {
    const raw = localStorage.getItem(TASK_COMMENT_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// A draft with nothing typed into it isn't worth keeping around — treat it the same as no
// draft at all, so just visiting a task you never touched doesn't leave an empty entry behind.
// Date is deliberately excluded here — it always carries a value (defaults to today) and
// keeping it alone doesn't mean there's anything to actually restore.
function isBlank(draft: TaskCommentDraft): boolean {
  return !draft.body.trim() && !draft.hours && !draft.actionTypeId && !draft.isPublic && !draft.followUpDate;
}

export function loadTaskCommentDraft(taskId: string): TaskCommentDraft | null {
  return loadAllDrafts()[taskId] ?? null;
}

export function saveTaskCommentDraft(taskId: string, draft: TaskCommentDraft): void {
  const all = loadAllDrafts();
  if (isBlank(draft)) {
    delete all[taskId];
  } else {
    all[taskId] = draft;
  }
  localStorage.setItem(TASK_COMMENT_DRAFT_STORAGE_KEY, JSON.stringify(all));
}

export function clearTaskCommentDraft(taskId: string): void {
  const all = loadAllDrafts();
  delete all[taskId];
  localStorage.setItem(TASK_COMMENT_DRAFT_STORAGE_KEY, JSON.stringify(all));
}
