"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useToast } from "@/context/ToastContext";
import { downloadFile } from "@/services/api";
import AppShell from "@/components/AppShell";
import { DailyPaymentForm, FinalSettlementForm, ProjectPicker } from "@/components/settlement/PaymentForms";
import { PaymentQueue } from "@/components/settlement/PaymentQueue";
import BulkEntryModal from "@/components/settlement/BulkEntryModal";
import { EmptyState } from "@/components/ui/Ui";
import { exportQuery, onRoadBase, paymentsBase, type QueueFilters } from "@/utils/settlement";

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
  const [bulk, setBulk] = useState(false);
  const [filters, setFilters] = useState<QueueFilters | null>(null); // what the table below is showing
  // RSA's two Excel exports: every approved payment (the accounts file), or whatever the table is filtered to. The server
  // records the export on the approved rows, so the list is reloaded.
  const exportExcel = async (kind: "approved" | "filtered") => {
    setBusy(true);
    try {
      const query = kind === "filtered" && filters ? `?${exportQuery(filters)}` : "";
      await downloadFile(`/settlements/export/${kind}${query}`, `${kind}-payments.xlsx`);
      toast(kind === "approved" ? "Approved payments exported" : "Filtered payments exported");
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
          {role === "RSA" && <button type="button" className="btn btn-primary" onClick={() => setBulk(true)}>Bulk Entry</button>}
          {role === "RSA" && (
            <>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => exportExcel("approved")}
                title="All approved Daily and Final payments awaiting payment, ignoring the table filters">Export Approved (Excel)</button>
              <button type="button" className="btn btn-outline btn-export-filtered" disabled={busy || !filters} onClick={() => exportExcel("filtered")}
                title="Only the payments matching the table's current category, status, search and dates (all pages)">Export Filtered (Excel)</button>
            </>
          )}
        </div>
      </div>
      <PaymentQueue mode="rbp" reloadKey={tick} onFilters={setFilters} />
      {bulk && <BulkEntryModal onClose={(attempted) => { setBulk(false); if (attempted) setTick((t) => t + 1); }} />}
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