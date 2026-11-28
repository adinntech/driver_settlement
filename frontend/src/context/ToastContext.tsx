"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error" | "info";
export interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});
let counter = 0;

/** Errors that need the user to do something outside the form (connection, session, server) stay longer. */
export const toastDuration = (kind: Kind, text: string) =>
  kind !== "error" ? 3200 : /network|reach|connect|server|failed to fetch|session|sign in|token|authentication/i.test(text) ? 10_000 : 5000;

/** One message per toast. The server joins validation messages with "; " (a lower-case continuation is one sentence). */
export const errorMessages = (value: string | string[] | null | undefined): string[] =>
  [...new Set((Array.isArray(value) ? value : [value ?? ""]).flatMap((m) => m.split(/; (?=[A-Z])/)).map((m) => m.trim()).filter(Boolean))];

/** What is on screen: every success / info toast, and only the oldest error; the other errors wait their turn. */
export function visibleToasts(toasts: Toast[]): Toast[] {
  const current = toasts.find((t) => t.kind === "error");
  return toasts.filter((t) => t.kind !== "error" || t === current);
}

export function ToastView({ toasts, onClose }: { toasts: Toast[]; onClose: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {visibleToasts(toasts).map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          {t.kind === "error" && (
            <svg className="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
            </svg>
          )}
          <span className="toast-text">{t.text}</span>
          {t.kind === "error" && <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onClose(t.id)}>×</button>}
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>()); // success / info toasts
  const close = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  const push = useCallback((text: string, kind: Kind = "success") => {
    if (kind === "error") {
      // joins the queue unless the same message is already shown or waiting
      for (const message of errorMessages(text)) {
        const id = ++counter;
        setToasts((t) => (t.some((x) => x.kind === "error" && x.text === message) ? t : [...t, { id, kind, text: message }]));
      }
      return;
    }
    const id = ++counter;
    setToasts((t) => [...t, { id, kind, text }]);
    timers.current.set(id, setTimeout(() => close(id), toastDuration(kind, text)));
  }, [close]);
  // an error's time starts when it comes to the front of the queue
  const error = toasts.find((t) => t.kind === "error");
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => close(error.id), toastDuration("error", error.text));
    return () => clearTimeout(timer);
  }, [error, close]);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastView toasts={toasts} onClose={close} />
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Like useState for a form's error(s): every time messages are set they are shown as error toasts. */
export function useErrorState<T extends string | string[] | null>(initial: T): [T, (value: T) => void] {
  const toast = useToast();
  const [error, setError] = useState<T>(initial);
  const set = useCallback((value: T) => {
    setError(value);
    for (const message of errorMessages(value)) toast(message, "error");
  }, [toast]);
  return [error, set];
}

/** For errors that arrive as data (a failed load): toasts them when they appear. Renders nothing. */
export function ErrorToasts({ errors }: { errors: string | null | undefined }) {
  const toast = useToast();
  useEffect(() => {
    if (errors) toast(errors, "error");
  }, [errors, toast]);
  return null;
}
