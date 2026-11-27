"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { apiActivity, cachedGet, fetchCached } from "@/services/api";

interface State<T> {
  key: string;
  path: string | null;
  data: T | null;
  error: string | null;
}

/** "/rsa/payments?page=2" -> "/rsa/payments": the same list with other filters / page / sort. */
const base = (p: string | null) => (p ? p.split("?")[0] : null);

/**
 * GET helper shared by every screen. `path` null = skip.
 *
 * Stale-while-revalidate: while a new request runs, the last good data stays on screen, so filters, sorting and paging update
 * the rows in place instead of swapping the table for a skeleton (no flicker, no layout shift; headers and scroll stay put).
 * Previous data is only kept for the same list (same path before "?"); a different record / page starts clean, so one
 * record's data is never shown as another's. Cached results appear instantly on revisits and are revalidated in the background.
 *
 *  - loading:    nothing to show yet (first load of this list)
 *  - refreshing: showing current or previous data while newer data loads
 *  - the newest request always wins (older replies are ignored); identical concurrent requests share one call.
 */
export function useApi<T>(path: string | null) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ key: "", path: null, data: null, error: null });
  const key = path ? `${path}#${tick}` : "";

  useEffect(() => {
    if (!path) return;
    let active = true;
    fetchCached<T>(path)
      .then((data) => active && setState({ key, path, data, error: null }))
      .catch((e: Error) => active && setState({ key, path, data: null, error: e.message }));
    return () => {
      active = false;
    };
  }, [path, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const fresh = !!path && state.key === key;
  const cached = path && tick === 0 ? (cachedGet(path) as T | undefined) : undefined;
  const data: T | null = !path ? null : fresh ? state.data : cached !== undefined ? cached : base(state.path) === base(path) ? state.data : null;
  const error = fresh ? state.error : null;
  const loading = !!path && !fresh && data === null;
  const refreshing = !!path && !fresh && data !== null;
  return { data, error, loading, refreshing, reload };
}

/** Number of API requests in flight (drives the thin progress bar in the app shell). */
export function useNetworkActivity(): number {
  return useSyncExternalStore(apiActivity.subscribe, apiActivity.count, () => 0);
}
