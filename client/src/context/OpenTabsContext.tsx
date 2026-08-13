import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export type OpenTabKind = "project" | "subProject" | "task";

export interface OpenTab {
  id: string;
  kind: OpenTabKind;
  name: string;
  path: string;
}

interface OpenTabsValue {
  tabs: OpenTab[];
  activeId: string | null;
  // Registers (or re-registers) a project, sub-project, or task as open and marks it the
  // active tab. Every detail page calls this on load with its own id — not just the parent
  // project's — so switching to a different tab and back returns you to exactly the task or
  // sub-project you were on, not just the project's overview.
  openTab: (id: string, kind: OpenTabKind, name: string, path: string) => void;
  closeTab: (id: string) => void;
}

const OpenTabsContext = createContext<OpenTabsValue | null>(null);

export const OPEN_TABS_STORAGE_KEY = "aurora-open-project-tabs";
const STORAGE_KEY = OPEN_TABS_STORAGE_KEY;

// Tabs saved before project/sub-project/task tabs were split apart only ever had {id, name}
// (always a project). Treat those as project tabs pointing at their own page, rather than
// dropping them and losing whatever the user had open across this change.
function loadStoredTabs(): OpenTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Record<string, unknown> => !!t && typeof t.id === "string" && typeof t.name === "string")
      .map((t) => ({
        id: t.id as string,
        name: t.name as string,
        kind: (t.kind === "subProject" || t.kind === "task" ? t.kind : "project") as OpenTabKind,
        path: typeof t.path === "string" ? t.path : `/projects/${t.id}`,
      }));
  } catch {
    return [];
  }
}

export function OpenTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<OpenTab[]>(loadStoredTabs);
  const [activeId, setActiveId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  }, [tabs]);

  const openTab = useCallback((id: string, kind: OpenTabKind, name: string, path: string) => {
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === id);
      if (!existing) return [...prev, { id, kind, name, path }];
      // Keep it in place, but refresh the name/path in case they changed since (a rename, or
      // the route shape shifting under it).
      if (existing.name === name && existing.path === path && existing.kind === kind) return prev;
      return prev.map((tab) => (tab.id === id ? { ...tab, kind, name, path } : tab));
    });
    setActiveId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((tab) => tab.id === id);
        if (index === -1) return prev;
        const next = [...prev.slice(0, index), ...prev.slice(index + 1)];
        if (id === activeId) {
          const fallback = next[index] ?? next[index - 1] ?? null;
          setActiveId(fallback ? fallback.id : null);
          // Only navigate away if we were actually the tab being viewed — closing a
          // background tab from the bar shouldn't yank you off whatever page you're on.
          navigate(fallback ? fallback.path : "/projects");
        }
        return next;
      });
    },
    [activeId, navigate]
  );

  const value = useMemo(() => ({ tabs, activeId, openTab, closeTab }), [tabs, activeId, openTab, closeTab]);

  return <OpenTabsContext.Provider value={value}>{children}</OpenTabsContext.Provider>;
}

export function useOpenTabs(): OpenTabsValue {
  const ctx = useContext(OpenTabsContext);
  if (!ctx) throw new Error("useOpenTabs must be used within an OpenTabsProvider");
  return ctx;
}
