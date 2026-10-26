// The kinds of billable services a contract line can be, matched to the "PS - ..." action types
// in lib/teamSupport.ts so time logged on a comment can be matched to its contract line
// automatically.
export const CONTRACT_CATEGORIES = [
  "Project Management",
  "Installation",
  "Data Conversion",
  "Training",
  "Go Live",
  "Support",
  "Other",
] as const;

export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

export function isContractCategory(value: string): value is ContractCategory {
  return (CONTRACT_CATEGORIES as readonly string[]).includes(value);
}

// TeamSupport action type name (as stored on a comment) -> the contract category its time
// belongs to. Action types with no entry here (scheduling, testing, calls...) never auto-match.
const CATEGORY_BY_ACTION_TYPE: Record<string, ContractCategory> = {
  "PS - Project Management": "Project Management",
  "PS - Server Install, User Setup": "Installation",
  "PS - License Delivery/Module Install": "Installation",
  "PS - Data Conversion": "Data Conversion",
  "PS - Data Audit/Issues": "Data Conversion",
  "PS - Training": "Training",
  "PS - Go Live": "Go Live",
  "PS - Post Go-Live Support": "Support",
  "PS - Support": "Support",
};

export function contractCategoryForActionType(actionTypeName: string | null | undefined): ContractCategory | null {
  return actionTypeName ? CATEGORY_BY_ACTION_TYPE[actionTypeName] ?? null : null;
}

// Data conversion lines on a contract are priced as a flat amount rather than a stated number of
// hours; they're worked out at this hourly rate (a $800 conversion line is 4 hours).
export const CONVERSION_RATE_PER_HOUR = 200;

// The hours to use for a line: what was given, or for a data conversion line with none, the
// amount divided by the conversion rate. Everything else without hours stays without.
export function defaultLineHours(
  category: string,
  hours: number | null | undefined,
  amount: number | null | undefined
): number | null {
  if (hours != null && hours > 0) return hours;
  if (category === "Data Conversion" && amount != null && amount > 0) {
    return Math.round((amount / CONVERSION_RATE_PER_HOUR) * 100) / 100;
  }
  return null;
}

// The category a task's own title points to ("Staff Training" -> Training, "Project Management" ->
// Project Management). The first rule that matches wins, so project management is checked first.
const TASK_TITLE_RULES: [RegExp, ContractCategory][] = [
  [/project management|\bpm\b/i, "Project Management"],
  [/train/i, "Training"],
  [/conver|data (audit|migration)/i, "Data Conversion"],
  [/go[- ]?live/i, "Go Live"],
  [/install|set ?up|config/i, "Installation"],
  [/support/i, "Support"],
];

export function contractCategoryForTaskTitle(title: string | null | undefined): ContractCategory | null {
  if (!title) return null;
  return TASK_TITLE_RULES.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}
