"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { request, tokenStore } from "@/services/api";
import type { AuthUser, RoleKey } from "@/types/domain";

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login: (role: RoleKey, username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!tokenStore.get()) {
      Promise.resolve().then(() => setReady(true));
      return;
    }
    request<AuthUser>("/auth/me")
      .then((u) => setUser({ username: u.username, role: u.role }))
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (role: RoleKey, username: string, password: string) => {
    const data = await request<{ token: string; user: AuthUser }>("/auth/login", "POST", {
      role,
      username,
      password,
    });
    tokenStore.set(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
