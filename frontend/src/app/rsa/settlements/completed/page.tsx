"use client";

import AppShell from "@/components/AppShell";
import { PaymentQueue } from "@/components/settlement/PaymentQueue";

/** Payments RSA has marked completed with the accounts payment reference. Records are kept permanently. */
export default function RsaCompleted() {
  return (
    <AppShell role="RSA">
      <div className="page-head">
        <div>
          <h1>Payment Completed</h1>
          <p className="muted">Daily and final payments that accounts have paid, with their payment reference.</p>
        </div>
      </div>
      <PaymentQueue mode="completed" />
    </AppShell>
  );
}