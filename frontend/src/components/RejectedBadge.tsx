"use client";

import { useEffect, useState } from "react";
import { request } from "@/services/api";
import { REJECTIONS_CHANGED } from "@/utils/rejectionViews";

/** Red count of rejected budgets RBP has not opened yet (polls every 30s, like the notification bell). */
export default function RejectedBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let latest = 0; // the newest request wins
    const load = () => {
      const mine = ++latest;
      request<{ count: number }>("/budgets/rejections/unviewed")
        .then((r) => mine === latest && setCount(r.count))
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener(REJECTIONS_CHANGED, load);
    return () => {
      latest = -1;
      clearInterval(timer);
      window.removeEventListener(REJECTIONS_CHANGED, load);
    };
  }, []);
  if (count < 1) return null;
  return <span className="nav-count" aria-label={`${count} rejected budgets not viewed`}>{count > 99 ? "99+" : count}</span>;
}
