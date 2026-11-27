"use client";

import AppShell from "@/components/AppShell";
import { ClearanceList } from "@/components/Clearance";

/** RBP: On-Road Vehicles list (RSA clearance status of vehicle + driver allocations). */
export default function OnRoadPage() {
  return (
    <AppShell role="RBP">
      <ClearanceList mode="RBP" />
    </AppShell>
  );
}
