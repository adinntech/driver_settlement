"use client";

import { useCallback, useEffect, useState } from "react";
import { request } from "@/services/api";

interface State<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/** GET helper. `path` null = skip. loading is derived, so no synchronous setState in effects. */
export function useApi<T>(path: string | null) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ key: "", data: null, error: null });
  const key = path ? `${path}#${tick}` : "";

  useEffect(() => {
    if (!path) return;
    let active = true;
    request<T>(path)
      .then((data) => active && setState({ key, data, error: null }))
      .catch((e: Error) => active && setState({ key, data: null, error: e.message }));
    return () => {
      active = false;
    };
  }, [path, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const loading = !!path && state.key !== key;
  return { data: loading ? null : state.data, error: loading ? null : state.error, loading, reload };
}
