import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { CurrentUser } from "../api/types";

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

  async function login(email: string, password: string) {
    const u = await api.post<CurrentUser>("/auth/login", { email, password });
    setUser(u);
  }

  async function register(name: string, email: string, password: string) {
    const u = await api.post<CurrentUser>("/auth/register", { name, email, password });
    setUser(u);
  }

  async function logout() {
    await api.post("/auth/logout");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>
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
  return "Something went wrong";
}
