"use client";

import { useBackendStatus } from "@/hooks/useBackendStatus";

const labels = {
  checking: "Checking backend…",
  online: "Backend connected",
  offline: "Backend unreachable",
} as const;

export default function BackendStatus() {
  const status = useBackendStatus();
  return (
    <span className={`status status-${status}`}>
      <span className="dot" /> {labels[status]}
    </span>
  );
}
