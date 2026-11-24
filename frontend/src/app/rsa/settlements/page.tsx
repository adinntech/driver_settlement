"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import { PaymentQueue } from "@/components/settlement/PaymentQueue";
import { useToast } from "@/context/ToastContext";
import { downloadFile } from "@/services/api";

/** RSA: pending and approved settlement payments. Approved ones are exported for accounts, then completed with the payment reference. */
export default function RsaSettlements() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const exportApproved = async () => {
    setBusy(true);
    try {
      await downloadFile("/settlements/export/approved", "approved-payments.xlsx");
      toast("Approved payments exported");
      setTick((t) => t + 1);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppShell role="RSA">
      <div className="page-head">
        <div>
          <h1>Settlement Payments</h1>
          <p className="muted">Export approved daily and final payments for the accounts team. When accounts return the payment reference, open the payment and mark it completed.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={exportApproved}>{busy ? "Exporting…" : "Export Approved (Excel)"}</button>
      </div>
      <PaymentQueue mode="queue" reloadKey={tick} />
    </AppShell>
  );
}