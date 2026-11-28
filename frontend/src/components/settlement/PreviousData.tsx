"use client";

import { useRef, useState, type ReactNode } from "react";
import DateInput from "@/components/ui/DateInput";
import Select from "@/components/ui/Select";
import { ConfirmDialog } from "@/components/ui/Ui";
import { useAuth } from "@/context/AuthContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import { todayIst } from "@/utils/dates";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";
import { newSubmissionKey, sanitizeAmount } from "@/utils/rsa";
import type { SettlementOptions, SuspenseRecords } from "@/utils/settlement";

export interface PreviousRecord {
  _id: string; entryId: string; revision: number; status: "DRAFT" | "SUBMITTED"; fromDate: string; toDate: string; paymentDate: string; paymentMode: string;
  bankName: string | null; referenceNumber: string; amount: number; vehicleNo?: string; sourceDetails: string; remarks: string | null; correctionReason: string | null;
  createdBy: string; createdByRole: string; createdAt: string;
  data: { cashInHand?: boolean; salaryAdvance?: number; foodAmount?: number; dieselEntries?: { amount: number }[]; expenses?: { optionKey: string; description: string | null; amount: number }[] };
}
export interface PreviousEntry { entryId: string; current: PreviousRecord; revisions: PreviousRecord[] }
type Action = "SUBMIT" | "DELETE" | "EDIT" | "CORRECT";

/** One initial submission per driver + vehicle + PIF (the list is already this driver and PIF). The server enforces it. */
export const hasSubmitted = (entries: PreviousEntry[], vehicleNo: string | undefined) => entries.some((e) => e.current.status === "SUBMITTED" && e.current.vehicleNo === vehicleNo);

/** Saved entries with their audit details and revision history. `onAction` is given to RSA only. */
export function PreviousDataTable({ entries, onAction }: { entries: PreviousEntry[]; onAction?: (a: Action, e: PreviousEntry) => void }) {
  if (!entries.length) return null;
  const locked = (r: PreviousRecord) => hasSubmitted(entries, r.vehicleNo); // a leftover draft can then only be deleted
  const line = (r: PreviousRecord) => (
    <>
      <td>{formatDate(r.fromDate)} – {formatDate(r.toDate)}</td>
      <td>{formatDate(r.paymentDate)}<br /><small className="muted">{r.paymentMode}</small></td>
      <td>{r.referenceNumber}</td>
      <td>{r.sourceDetails}{r.remarks && <><br /><small className="muted">{r.remarks}</small></>}{r.correctionReason && <><br /><small className="muted">Correction: {r.correctionReason}</small></>}</td>
      <td>{r.createdBy} ({r.createdByRole})<br /><small className="muted">{formatDateTime(r.createdAt)}</small></td>
      <td className="ds-amt">{formatInr(r.amount)}</td>
    </>
  );
  return (
    <table className="table ds-mini" data-section="previous-data">
      <thead><tr><th>Previous Data</th><th>Period</th><th>Payment Date</th><th>Reference No. / UTR</th><th>Source Details</th><th>Entered By</th><th className="ds-amt">Amount</th><th /></tr></thead>
      <tbody>
        {entries.flatMap((e) => e.revisions.map((r, i) => (
          <tr key={r._id} className={i ? "muted" : undefined}>
            <td>{i ? <small>Earlier revision {r.revision} (not counted)</small> : <span className="badge badge-created">{r.status === "DRAFT" ? "Draft (not counted)" : r.revision > 1 ? `Historical · revision ${r.revision}` : "Historical"}</span>}</td>
            {line(r)}
            <td className="ds-nowrap">
              {!i && onAction && (r.status === "DRAFT"
                ? ((locked(r) ? ["DELETE"] : ["EDIT", "SUBMIT", "DELETE"]) as Action[]).map((a) => <button key={a} type="button" className="btn btn-outline btn-sm" onClick={() => onAction(a, e)}>{a === "EDIT" ? "Edit" : a === "SUBMIT" ? "Submit" : "Delete"}</button>)
                : <button type="button" className="btn btn-outline btn-sm" onClick={() => onAction("CORRECT", e)}>Correct</button>)}
            </td>
          </tr>
        )))}
      </tbody>
    </table>
  );
}

interface Identity { trackingVehicle: string; driverNumber: string; driverName: string; trackupNumber: string; pifNumber: string; vehicleNo: string }
type Saved = { suspense: SuspenseRecords };
const url = (who: Identity) => `/settlements/projects/${who.trackingVehicle}/previous-data`;

/** Inside the Suspense Amount popup: the saved entries and, for RSA, adding, drafting and correcting them. */
export function PreviousDataPanel({ who, total, onSuspense }: { who: Identity; total: number; onSuspense: (s: SuspenseRecords) => void }) {
  const isRsa = useAuth().user?.role === "RSA";
  const list = useApi<PreviousEntry[]>(url(who));
  const [editing, setEditing] = useState<{ mode: "NEW" | "EDIT" | "CORRECT"; entry?: PreviousEntry } | null>(null);
  const [confirm, setConfirm] = useState<{ action: "SUBMIT" | "DELETE"; entry: PreviousEntry } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const entries = list.data ?? [];
  const changed = (s?: SuspenseRecords) => {
    if (s) onSuspense(s);
    list.reload();
  };

  async function run() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      const path = `${url(who)}/${confirm.entry.entryId}`;
      const r = confirm.action === "SUBMIT" ? await request<Saved>(`${path}/submit`, "POST", {}) : await request<Partial<Saved>>(path, "DELETE");
      changed(r.suspense);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConfirm(null);
      setBusy(false);
    }
  }

  if (editing)
    return <PreviousDataForm who={who} mode={editing.mode} entry={editing.entry} onCancel={() => setEditing(null)} onSaved={(s) => { setEditing(null); changed(s); }} />;
  return (
    <>
      {(error || list.error) && <div className="alert" role="alert">{error || list.error}</div>}
      <PreviousDataTable entries={entries} onAction={isRsa ? (a, entry) => (a === "EDIT" || a === "CORRECT" ? setEditing({ mode: a, entry }) : setConfirm({ action: a, entry })) : undefined} />
      {isRsa && hasSubmitted(entries, who.vehicleNo) && <p className="muted">Previous Data has already been submitted for this driver, vehicle and PIF. Use Correct to change it.</p>}
      {isRsa && !list.loading && !hasSubmitted(entries, who.vehicleNo) && (
        <div className="actions-row">
          <button type="button" className={total ? "btn btn-outline btn-sm" : "btn btn-primary"} onClick={() => setEditing({ mode: "NEW" })}>+ Add Previous Data</button>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.action === "SUBMIT" ? "Submit previous data?" : "Delete draft?"}
          message={confirm.action === "SUBMIT" ? "This records a completed Daily Payment, adds it to the Suspense Amount, and can then only be changed by a recorded correction." : "This draft is removed. It has not counted towards any amount."}
          confirmLabel={confirm.action === "SUBMIT" ? "Submit" : "Delete"} busy={busy} onConfirm={run} onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

interface Expense { optionKey: string; description: string; amount: string }
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="field"><span>{label}</span>{children}</div>
);
const text = (n: number | undefined) => (n ? String(n) : "");

export function PreviousDataForm({ who, mode, entry, onSaved, onCancel }: { who: Identity; mode: "NEW" | "EDIT" | "CORRECT"; entry?: PreviousEntry; onSaved: (suspense: SuspenseRecords) => void; onCancel: () => void }) {
  const opts = useApi<SettlementOptions>("/settlements/options");
  const old = entry?.current; // editing or correcting starts from the saved values; nothing else is ever prefilled
  const [f, setF] = useState({
    fromDate: old?.fromDate ?? "", toDate: old?.toDate ?? "", paymentDate: old?.paymentDate ?? "", referenceNumber: old?.referenceNumber ?? "", paymentMode: old?.paymentMode ?? "",
    bankName: old?.bankName ?? "", salaryAdvance: text(old?.data.salaryAdvance), diesel: text(old?.data.dieselEntries?.reduce((s, d) => s + d.amount, 0)), food: text(old?.data.foodAmount),
    sourceDetails: old?.sourceDetails ?? "", remarks: old?.remarks ?? "", reason: "",
  });
  const [cashInHand, setCashInHand] = useState(!!old?.data.cashInHand);
  const [expenses, setExpenses] = useState<Expense[]>(() => (old?.data.expenses ?? []).map((x) => ({ optionKey: x.optionKey, description: x.description ?? "", amount: String(x.amount) })));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(newSubmissionKey()); // the same key on retry, so one entry is never saved twice
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const row = (i: number, patch: Partial<Expense>) => setExpenses((l) => l.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const today = todayIst();
  const options = opts.data?.dailyExpenseOptions ?? [];

  async function save(submit: boolean) {
    setBusy(true);
    setError("");
    const { salaryAdvance, diesel, food, reason, ...rest } = f;
    const body = { ...rest, cashInHand, salaryAdvance, foodAmount: food, dieselEntries: diesel ? [{ amount: diesel }] : [], expenses, idempotencyKey: key.current };
    try {
      const r = mode === "CORRECT"
        ? await request<Saved>(`${url(who)}/${entry!.entryId}/corrections`, "POST", { ...body, reason, revision: old!.revision })
        : mode === "EDIT"
          ? await request<Saved>(`${url(who)}/${entry!.entryId}`, "PUT", body)
          : await request<Saved>(url(who), "POST", { ...body, submit });
      onSaved(r.suspense);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const amount = (k: "salaryAdvance" | "diesel" | "food", label: string) => (
    <Field label={label}><input className="num-input" inputMode="decimal" aria-label={label} value={f[k]} onChange={(e) => set(k, sanitizeAmount(e.target.value))} /></Field>
  );
  const input = (k: "referenceNumber" | "bankName" | "sourceDetails" | "remarks" | "reason", label: string, max: number) => (
    <Field label={label}><input aria-label={label} maxLength={max} value={f[k]} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  const date = (k: "fromDate" | "toDate" | "paymentDate", label: string, min?: string) => (
    <Field label={label}><DateInput value={f[k]} min={min} max={today} onChange={(e) => set(k, e.target.value)} aria-label={label} /></Field>
  );

  return (
    <>
      <h4 className="sub">{mode === "CORRECT" ? `Correct entry (creates revision ${old!.revision + 1}; earlier values are kept)` : mode === "EDIT" ? "Edit draft" : "Add Previous Data"}</h4>
      <dl className="kv">
        {([["Driver Number", who.driverNumber], ["Driver Name", who.driverName], ["Project / Trackup Number", who.trackupNumber], ["PIF Number", who.pifNumber], ["Vehicle Number", who.vehicleNo]] as const).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="grid">
        {date("fromDate", "From Date *")}
        {date("toDate", "To Date *", f.fromDate || undefined)}
        {date("paymentDate", "Payment Date *")}
        {input("referenceNumber", "Reference No. / UTR *", 60)}
        <Field label="Payment Mode *">
          <Select value={f.paymentMode} onChange={(e) => set("paymentMode", e.target.value)} aria-label="Payment Mode">
            <option value="">Select</option>
            {(opts.data?.paymentModes ?? []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        {input("bankName", "Bank Name", 120)}
        <Field label="Cash in Hand"><label><input type="checkbox" checked={cashInHand} onChange={(e) => setCashInHand(e.target.checked)} /> Yes</label></Field>
        {amount("salaryAdvance", "Salary Advance")}
        {amount("diesel", "Fuel Amount")}
        {amount("food", "Food Amount")}
        {input("sourceDetails", "Source Details", 200)}
        {input("remarks", "Remarks", 500)}
        {mode === "CORRECT" && input("reason", "Reason for correction *", 500)}
      </div>
      <h4 className="sub">Expense details</h4>
      {expenses.map((x, i) => (
        <div className="actions-row" key={i}>
          <Select value={x.optionKey} onChange={(e) => row(i, { optionKey: e.target.value })} aria-label={`Expense ${i + 1} type`}>
            <option value="">Select</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
          <input aria-label={`Expense ${i + 1} description`} placeholder="Description" maxLength={200} value={x.description} onChange={(e) => row(i, { description: e.target.value })} />
          <input className="num-input" inputMode="decimal" aria-label={`Expense ${i + 1} amount`} placeholder="Amount" value={x.amount} onChange={(e) => row(i, { amount: sanitizeAmount(e.target.value) })} />
          <button type="button" className="icon-btn" aria-label={`Remove expense ${i + 1}`} onClick={() => setExpenses((l) => l.filter((_, n) => n !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setExpenses((l) => [...l, { optionKey: "", description: "", amount: "" }])}>+ Add expense</button>
      <p className="muted">Enter the values exactly as on the original record. Submit records a completed Daily Payment at once. A draft can be edited or deleted; a submitted entry changes only through a recorded correction.</p>
      <div className="actions-row">
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
        {mode === "NEW" && <button type="button" className="btn btn-outline" onClick={() => save(false)} disabled={busy}>Save Draft</button>}
        <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={busy}>{busy ? "Saving…" : mode === "CORRECT" ? "Save Correction" : mode === "EDIT" ? "Save Draft" : "Submit"}</button>
      </div>
    </>
  );
}
