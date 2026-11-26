"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useToast } from "@/context/ToastContext";
import { downloadFile } from "@/services/api";
import AppShell from "@/components/AppShell";
import { DailyPaymentForm, FinalSettlementForm, ProjectPicker } from "@/components/settlement/PaymentForms";
import { PaymentQueue } from "@/components/settlement/PaymentQueue";
import { EmptyState } from "@/components/ui/Ui";
import { onRoadBase, paymentsBase } from "@/utils/settlement";

/**
 * The shared Driver Payments module. RBP and RSA open the same pages over the same records (one `settlementpayments`
 * collection): each role only gets its own route prefix and sidebar. Approval and completion rights stay role-specific.
 */
type EntryRole = "RBP" | "RSA";
const OID = /^[a-f0-9]{24}$/i;

export function DriverPaymentsList({ role }: { role: EntryRole }) {
  const base = paymentsBase(role);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  // RSA's accounts export (moved here from the former Settlement Payments page): approved daily + final payments awaiting payment.
  // Same endpoint, columns and filters as before; the server records each export on the rows, so the list is reloaded.
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
    <AppShell role={role}>
      <div className="page-head">
        <div>
          <h1>Driver Payments</h1>
          <p className="muted">
            One shared list for RBP and RSA. Daily vehicle payments (entered from On Road Vehicles) go to RSOM; final driver salary settlements go to RSO.
            {role === "RSA" && " Export approved payments for accounts, then record each payment with Entry."}
          </p>
        </div>
        <div className="inline ds-gap">
          <Link href={onRoadBase(role)} className="btn btn-outline">On Road Vehicles</Link>
          <Link href={`${base}/new?type=final`} className="btn btn-primary">+ Final Driver Settlement</Link>
          {role === "RSA" && <button type="button" className="btn btn-outline" disabled={busy} onClick={exportApproved}>{busy ? "Exporting…" : "Export Approved (Excel)"}</button>}
        </div>
      </div>
      <PaymentQueue mode="rbp" reloadKey={tick} />
    </AppShell>
  );
}

export function DriverPaymentsNew({ role }: { role: EntryRole }) {
  return (
    <AppShell role={role}>
      <Suspense>
        <NewInner role={role} />
      </Suspense>
    </AppShell>
  );
}
function NewInner({ role }: { role: EntryRole }) {
  const kind = useSearchParams().get("type") === "final" ? "final" : "daily";
  return (
    <>
      <div className="page-head">
        <div>
          <Link href={paymentsBase(role)} className="back">← Back to driver payments</Link>
          <h1>{kind === "final" ? "Final Driver Salary & Expenses" : "Daily Vehicle Payment"}</h1>
          <p className="muted">Select the project vehicle. Only projects with an RSOM-approved budget and an allotted vehicle and driver are listed.</p>
        </div>
      </div>
      <ProjectPicker kind={kind} />
    </>
  );
}

export function DriverPaymentsForm({ role, kind }: { role: EntryRole; kind: "daily" | "final" }) {
  return (
    <AppShell role={role}>
      <Suspense>
        <FormInner kind={kind} />
      </Suspense>
    </AppShell>
  );
}
function FormInner({ kind }: { kind: "daily" | "final" }) {
  const sp = useSearchParams();
  const tv = sp.get("tv");
  const id = sp.get("id");
  const Form = kind === "daily" ? DailyPaymentForm : FinalSettlementForm;
  // no separate header row: the form window's own title bar carries the Back link
  return (
    <>
      {tv && OID.test(tv) ? <Form tv={tv} id={id && OID.test(id) ? id : null} /> : <EmptyState title="No project selected" hint="Go back and select a project vehicle." />}
    </>
  );
}