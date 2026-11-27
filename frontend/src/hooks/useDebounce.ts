"use client";

import { useEffect, useState } from "react";

/** Returns `value` after it has stopped changing for `delay` ms (avoids an API call per keystroke). */
export function useDebounce<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
