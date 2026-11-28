"use client";

import { useEffect, useState } from "react";
import { request } from "@/services/api";
import { REJECTIONS_CHANGED } from "@/utils/rejectionViews";

/** Red count of rejections RBP has not opened yet (polls every 30s, like the notification bell). Budgets by default. */
export default function RejectedBadge({ path = "/budgets/rejections/unviewed", event = REJECTIONS_CHANGED, what = "rejected budgets" }: { path?: string; event?: string; what?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let latest = 0; // the newest request wins
    const load = () => {
      const mine = ++latest;
      request<{ count: number }>(path)
        .then((r) => mine === latest && setCount(r.count))
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener(event, load);
    return () => {
      latest = -1;
      clearInterval(timer);
      window.removeEventListener(event, load);
    };
  }, [path, event]);
  if (count < 1) return null;
  return <span className="nav-count" aria-label={`${count} ${what} not viewed`}>{count > 99 ? "99+" : count}</span>;
}
