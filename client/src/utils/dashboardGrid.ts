import type { Layout, LayoutItem } from "react-grid-layout";
import type { DashboardWidgetEntry, DashboardWidgetKey, DashboardWidgetSize } from "../api/types";

// The Dashboard is a 12-column grid with fixed-height rows; each card occupies w columns by h
// rows. These are the shared numbers for the grid itself and for the default footprint of each
// card (what a never-moved card, or one just added back, starts as).
export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 40;
export const GRID_MARGIN: readonly [number, number] = [16, 16];
// Below this container width there's no room for a free grid, so the cards simply stack.
export const GRID_MIN_WIDTH = 720;

const WIDTH_BY_SIZE: Record<DashboardWidgetSize, number> = { S: 4, M: 6, L: 12 };

const DEFAULT_HEIGHT: Record<DashboardWidgetKey, number> = {
  totalProjects: 2,
  completedThisWeek: 2,
  hoursLogged: 2,
  deadlines: 12,
  projectProgress: 6,
  recentActivity: 6,
  myTasks: 6,
  myProjects: 6,
};

const STAT_TILES: DashboardWidgetKey[] = ["totalProjects", "completedThisWeek", "hoursLogged"];

// A card's size label follows its width, so the list cards still know how many rows to show
// and the number tiles pick a matching font size, however the user dragged it.
export function sizeForWidth(w: number): DashboardWidgetSize {
  if (w <= 4) return "S";
  if (w <= 8) return "M";
  return "L";
}

export function hasPlacement(entry: DashboardWidgetEntry): entry is DashboardWidgetEntry & Required<Pick<DashboardWidgetEntry, "x" | "y" | "w" | "h">> {
  return entry.x != null && entry.y != null && entry.w != null && entry.h != null;
}

// Gives every entry a grid position. Ones the user has already placed keep it; the rest (never
// customized, or saved before cards could be moved, or just added back) flow left to right
// under everything else, in order, wrapping when a row is full.
export function placeEntries(entries: DashboardWidgetEntry[]): Array<Required<Pick<DashboardWidgetEntry, "x" | "y" | "w" | "h">> & DashboardWidgetEntry> {
  const placed = entries.filter(hasPlacement);
  let rowTop = placed.reduce((bottom, e) => Math.max(bottom, e.y + e.h), 0);
  let x = 0;
  let rowHeight = 0;
  return entries.map((entry) => {
    if (hasPlacement(entry)) return entry;
    const w = WIDTH_BY_SIZE[entry.size];
    const h = DEFAULT_HEIGHT[entry.key];
    if (x + w > GRID_COLS) {
      rowTop += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    const result = { ...entry, x, y: rowTop, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    return result;
  });
}

export function toGridLayout(entries: DashboardWidgetEntry[]): LayoutItem[] {
  return placeEntries(entries).map((e) => {
    const isTile = STAT_TILES.includes(e.key);
    return { i: e.key, x: e.x, y: e.y, w: e.w, h: e.h, minW: isTile ? 2 : 3, minH: isTile ? 2 : 4 };
  });
}

// Folds the grid's current layout back into the saved entries (keeping their order as it
// reads on screen: top to bottom, then left to right).
export function entriesFromLayout(layout: Layout, entries: DashboardWidgetEntry[]): DashboardWidgetEntry[] {
  const byKey = new Map(layout.map((item) => [item.i, item]));
  return entries
    .map((entry) => {
      const item = byKey.get(entry.key);
      return item ? { key: entry.key, size: sizeForWidth(item.w), x: item.x, y: item.y, w: item.w, h: item.h } : entry;
    })
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
}

export function sameLayout(a: DashboardWidgetEntry[], b: DashboardWidgetEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.key === b[i].key && e.x === b[i].x && e.y === b[i].y && e.w === b[i].w && e.h === b[i].h);
}

// A card added back from the hidden list lands at the bottom at its default footprint.
export function newEntry(key: DashboardWidgetKey, entries: DashboardWidgetEntry[]): DashboardWidgetEntry {
  const size: DashboardWidgetSize = STAT_TILES.includes(key) ? "S" : "L";
  const bottom = placeEntries(entries).reduce((max, e) => Math.max(max, e.y + e.h), 0);
  return { key, size, x: 0, y: bottom, w: WIDTH_BY_SIZE[size], h: DEFAULT_HEIGHT[key] };
}
