import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { CurrentUser } from "../api/types";
import i18n, { LOCALE_TO_I18N_LANGUAGE } from "../i18n";
import { OPEN_TABS_STORAGE_KEY } from "./OpenTabsContext";
import { TASK_COMMENT_DRAFT_STORAGE_KEY } from "../utils/taskCommentDraft";

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  canWrite: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (u: CurrentUser) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000;
const LAST_ACTIVITY_STORAGE_KEY = "aurora-last-activity";
export const IDLE_LOGOUT_NOTICE_KEY = "aurora-idle-logout";
// An idle logout (unlike a manual one) keeps the user's open-tab bar, stashed per user id so only
// that same person gets it back — the next person on a shared browser never sees it.
const IDLE_TABS_STASH_PREFIX = "aurora-idle-tabs:";
const IDLE_TABS_STASH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function stashOpenTabs(userId: string) {
  try {
    const tabs = localStorage.getItem(OPEN_TABS_STORAGE_KEY);
    if (tabs) localStorage.setItem(IDLE_TABS_STASH_PREFIX + userId, JSON.stringify({ savedAt: Date.now(), tabs }));
  } catch {
    // Losing the stash just means the tab bar starts empty after the next login.
  }
}

function restoreStashedOpenTabs(userId: string) {
  try {
    const key = IDLE_TABS_STASH_PREFIX + userId;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    localStorage.removeItem(key);
    const stash = JSON.parse(raw) as { savedAt?: number; tabs?: string };
    if (typeof stash.tabs === "string" && typeof stash.savedAt === "number" && Date.now() - stash.savedAt < IDLE_TABS_STASH_MAX_AGE_MS) {
      localStorage.setItem(OPEN_TABS_STORAGE_KEY, stash.tabs);
    }
  } catch {
    // A corrupt stash is simply ignored.
  }
}

// Kept in localStorage (not component state) so activity in any open tab counts, and so a
// closed tab or sleeping laptop is still caught the next time the app loads.
function readLastActivity(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastActivity(now: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
  } catch {
    // Storage blocked — the idle timeout just won't persist across tabs/reloads.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<CurrentUser>("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const language = user ? LOCALE_TO_I18N_LANGUAGE[user.locale] : undefined;
    if (language) {
      i18n.changeLanguage(language);
    }
  }, [user?.locale]);

  async function login(email: string, password: string) {
    const u = await api.post<CurrentUser>("/auth/login", { email, password });
    writeLastActivity(Date.now());
    restoreStashedOpenTabs(u.id);
    setUser(u);
  }

  function clearLocalSessionData() {
    // A shared browser could hand the next login someone else's open-project tabs, or an
    // in-progress comment draft, otherwise — clear both along with the session itself.
    localStorage.removeItem(OPEN_TABS_STORAGE_KEY);
    localStorage.removeItem(TASK_COMMENT_DRAFT_STORAGE_KEY);
    localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  }

  async function logout() {
    await api.post("/auth/logout");
    setUser(null);
    clearLocalSessionData();
  }

  // Signs out after IDLE_TIMEOUT_MS with no mouse, keyboard, scroll or touch input. Background
  // polling (the dashboard refreshes every 15s) deliberately doesn't count as activity.
  useEffect(() => {
    if (!user) return;

    const userId = user.id;

    function endIdleSession() {
      stashOpenTabs(userId);
      try {
        sessionStorage.setItem(IDLE_LOGOUT_NOTICE_KEY, "1");
      } catch {
        // Notice is a nicety; the logout itself must still happen.
      }
      // Local state is cleared even if the request fails (e.g. offline) so the screen locks anyway.
      api.post("/auth/logout").catch(() => undefined);
      setUser(null);
      clearLocalSessionData();
    }

    function checkIdle() {
      const last = readLastActivity();
      if (last !== null && Date.now() - last > IDLE_TIMEOUT_MS) {
        endIdleSession();
        return true;
      }
      return false;
    }

    // Covers reopening the app after a long gap (closed tab, sleeping laptop).
    if (checkIdle()) return;
    if (readLastActivity() === null) writeLastActivity(Date.now());

    let lastWrite = 0;
    function onActivity() {
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite = now;
      writeLastActivity(now);
    }

    const events = ["mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    const interval = window.setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkIdle();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id]);

  const canWrite = user?.role !== "READ_ONLY";

  return (
    <AuthContext.Provider value={{ user, loading, canWrite, login, logout, updateUser: setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return i18n.t("common.somethingWentWrong");
}
