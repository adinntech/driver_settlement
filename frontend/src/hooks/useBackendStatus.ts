"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/services/api";

export type BackendStatus = "checking" | "online" | "offline";

export function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>("checking");

  useEffect(() => {
    let active = true;
    getHealth()
      .then((r) => active && setStatus(r.success ? "online" : "offline"))
      .catch(() => active && setStatus("offline"));
    return () => {
      active = false;
    };
  }, []);

  return status;
}
