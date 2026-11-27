"use client";

import AppShell from "@/components/AppShell";
import { ClearanceList } from "@/components/Clearance";

/** RSA: Vehicle & Driver Clearance list (separate from Payments). */
export default function RsaClearancePage() {
  return (
    <AppShell role="RSA">
      <ClearanceList mode="RSA" />
    </AppShell>
  );
}
