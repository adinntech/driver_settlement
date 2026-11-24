"use client";

import { useCallback, useEffect } from "react";

/**
 * Protects a dirty form: the browser asks before a reload / tab close, and `confirmLeave()` asks before in-app navigation
 * (Cancel / Close / Back links). Returns true when it is fine to leave.
 */
export function useUnsavedChanges(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  return useCallback(() => !dirty || window.confirm(message), [dirty, message]);
}
