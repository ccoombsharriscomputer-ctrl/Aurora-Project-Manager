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
