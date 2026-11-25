"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState that survives navigation within the browser tab (sessionStorage): list filters, sort and page come back when the user
 * returns with the browser Back button or the sidebar. Falls back to plain state when storage is unavailable.
 */
/** Removes every saved list state (`ds:*`): called on sign-out so the next user / role starts with clean filters. */
export function clearSessionState(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("ds:")) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function useSessionState<T extends object>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = sessionStorage.getItem(`ds:${key}`);
      return raw ? ({ ...initial, ...JSON.parse(raw) } as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(`ds:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  }, [key, value]);
  return [value, setValue];
}
