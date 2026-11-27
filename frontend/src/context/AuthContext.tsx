"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearSessionState } from "@/hooks/useSessionState";
import { request, TOKEN_KEY, tokenStore } from "@/services/api";
import { BASE_PATH } from "@/utils/config";
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

  // Sign-out is local only (stateless JWT: there is no server session to end), so it cannot hang on the network.
  //  1. drop the token, the shared GET cache and in-flight request dedupe, and the saved list filters
  //  2. leave with a full page load, replacing the current history entry. With cacheComponents, Next keeps up to 3 visited routes
  //     alive but hidden (<Activity>), with their state: a client-side router.replace would bring back those preserved pages,
  //     including the login form still showing "Signing in…" from the previous sign-in. A full load discards all of them,
  //     aborts any pending authenticated request, and Back cannot return to the workspace entry that was replaced.
  const signingOut = useRef(false);
  const logout = useCallback(() => {
    if (signingOut.current) return; // double click: one sign-out only
    signingOut.current = true;
    tokenStore.clear();
    clearSessionState();
    setUser(null);
    window.location.replace(`${BASE_PATH}/login`);
  }, []);

  useEffect(() => {
    // Back / Forward restoring a signed-in page from the browser's back-forward cache after sign-out: reload as signed out.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && !tokenStore.get() && window.location.pathname !== `${BASE_PATH}/login`) window.location.replace(`${BASE_PATH}/login`);
    };
    // Signed out in another tab of the same browser: end this tab's session too.
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY && !e.newValue && window.location.pathname !== `${BASE_PATH}/login`) window.location.replace(`${BASE_PATH}/login`);
    };
    window.addEventListener("pageshow", onShow);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
