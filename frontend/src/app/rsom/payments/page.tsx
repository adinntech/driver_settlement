"use client";

import AppShell from "@/components/AppShell";
import { PaymentQueue } from "@/components/settlement/PaymentQueue";

/** RSOM approves or rejects daily vehicle payments. Final settlements are visible here but are decided by RSO. */
export default function RsomPayments() {
  return (
    <AppShell role="RSOM">
      <div className="page-head">
        <div>
          <h1>Daily Payment Approvals</h1>
          <p className="muted">Approve or reject daily vehicle payments submitted by RBP. Final driver settlements are approved by RSO.</p>
        </div>
      </div>
      <PaymentQueue mode="queue" defaultCategory="DAILY" />
    </AppShell>
  );
}