import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export interface OpenTab {
  id: string;
  name: string;
}

interface OpenTabsValue {
  tabs: OpenTab[];
  activeId: string | null;
  // Registers (or re-registers) a project as open and marks it the active tab. Every page
  // that renders "inside" a project — the project itself, one of its sub-projects, or a task
  // under it — calls this on load, so the tab bar always reflects wherever you actually are,
  // even on routes (like /tasks/:id) whose URL doesn't literally start with /projects/:id.
  openTab: (id: string, name: string) => void;
  closeTab: (id: string) => void;
}

const OpenTabsContext = createContext<OpenTabsValue | null>(null);

export const OPEN_TABS_STORAGE_KEY = "aurora-open-project-tabs";
const STORAGE_KEY = OPEN_TABS_STORAGE_KEY;

function loadStoredTabs(): OpenTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is OpenTab => !!t && typeof t.id === "string" && typeof t.name === "string"
    );
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

  const openTab = useCallback((id: string, name: string) => {
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === id);
      if (!existing) return [...prev, { id, name }];
      // Keep it in place, but refresh the name in case the project was renamed since.
      if (existing.name === name) return prev;
      return prev.map((tab) => (tab.id === id ? { ...tab, name } : tab));
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
          navigate(fallback ? `/projects/${fallback.id}` : "/projects");
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
