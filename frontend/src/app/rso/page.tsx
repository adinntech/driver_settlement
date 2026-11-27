"use client";

import AppShell from "@/components/AppShell";
import { PaymentQueue } from "@/components/settlement/PaymentQueue";

/** RSO approves or rejects final driver salary settlements and downloads the individual salary PDFs. */
export default function RsoHome() {
  return (
    <AppShell role="RSO">
      <div className="page-head">
        <div>
          <h1>Final Settlement Approvals</h1>
          <p className="muted">Approve final driver salary &amp; expense settlements. Open an approved settlement to download the driver&apos;s salary PDF.</p>
        </div>
      </div>
      <PaymentQueue mode="queue" defaultCategory="FINAL" />
    </AppShell>
  );
}