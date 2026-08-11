import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { CurrentUser } from "../api/types";
import i18n, { LOCALE_TO_I18N_LANGUAGE } from "../i18n";
import { OPEN_TABS_STORAGE_KEY } from "./OpenTabsContext";

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  canWrite: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (u: CurrentUser) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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
    setUser(u);
  }

  async function logout() {
    await api.post("/auth/logout");
    setUser(null);
    // A shared browser could hand the next login someone else's open-project tabs
    // otherwise — clear them along with the session itself.
    localStorage.removeItem(OPEN_TABS_STORAGE_KEY);
  }

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
