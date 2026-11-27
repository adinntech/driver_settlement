"use client";

import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { request } from "@/services/api";
import { formatDate, formatDateTime } from "@/utils/format";
import {
  PAYMENT_FOR_LABEL, amountPaise, dash, emptyDieselDraft, emptyExpenseDraft, emptyPaymentForm, money, newSubmissionKey, overlapWarnings, rowId, sanitizeAmount, toPaymentPayload,
  totals, validateDieselDraft, validateExpenseDraft, validatePaymentForm, type DieselDraft, type ExpenseDraft, type ExpenseRow, type PaymentForm, type RsaContext, type RsaOptions, type RsaPaymentRow,
} from "@/utils/rsa";

const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);
const Errors = ({ list }: { list: string[] }) =>
  list.length ? <div className="alert" role="alert">{list.map((e) => <div key={e}>{e}</div>)}</div> : null;

/** Top block, like the reference screen: job sheet, vehicle, client, driver (+ payment number). Read-only. */
export function ProjectHeader({ ctx }: { ctx: RsaContext }) {
  return (
    <div className="rsa-head" data-section="project-header">
      <div className="rsa-head-lines">
        <div><span>JobSheet No:</span> <strong>{ctx.trackupNumber}</strong></div>
        <div><span>PIF No:</span> <strong>{ctx.pifNumber}</strong></div>
        <div><span>Vehicle No:</span> <strong>{ctx.vehicle.vehicleNo}</strong></div>
        {ctx.requestedVehicleType && <div><span>Vehicle Type:</span> <strong>{ctx.requestedVehicleType}</strong></div>}
        <div><span>Client Name:</span> <strong>{ctx.clientName}</strong></div>
        <div><span>Driver:</span> <strong>{ctx.driver.driverNumber} · {ctx.driver.driverName}</strong></div>
        <div><span>Project Type:</span> <strong>{PAYMENT_FOR_LABEL[ctx.projectType]}</strong></div>
      </div>
      <div className="rsa-head-no"><span>Payment No:</span> <strong>Generated on save</strong></div>
    </div>
  );
}

export function ExpenseTable({
  rows, selected, onToggle, onEdit, onDelete,
}: { rows: ExpenseRow[]; selected: string[]; onToggle: (id: string) => void; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <table className="table rsa-exp" data-section="expense-table">
      <thead><tr><th /><th>Detail</th><th>Description</th><th>Amount</th><th>Deduct</th><th>Actions</th></tr></thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={6} className="muted">No expense rows added.</td></tr>
        ) : rows.map((r) => (
          <tr key={r.id}>
            <td><input type="checkbox" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} aria-label={`Select ${r.optionLabel}`} /></td>
            <td>{r.optionLabel}{r.isDefault ? <small className="muted"> · default</small> : null}</td>
            <td>{dash(r.description)}</td>
            <td>{money(amountPaise(r.amount) ?? 0)}</td>
            <td>{r.deduct ? "Yes" : "—"}</td>
            <td>
              <div className="inline row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(r.id)}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(r.id)}>Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Payment history (used inside the history drawer). Each row has an Expand / Collapse button: the complete saved payment opens
 * right under its own row and closes again, so nothing ever opens on top of (or behind) the drawer.
 */
export function PaymentHistoryTable({
  items, total, page, limit, onPage, initiallyOpen = [],
}: { items: RsaPaymentRow[]; total: number; page: number; limit: number; onPage: (p: number) => void; initiallyOpen?: string[] }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const [open, setOpen] = useState<string[]>(initiallyOpen);
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  return (
    <div className="rsa-history" data-section="payment-history">
      <h3 className="sub">Payment History</h3>
      {items.length === 0 ? (
        <EmptyState title="No payments yet" hint="Saved payment entries for this project appear here, latest first." />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Payment No</th><th>Amount</th><th>Mode</th><th>Bank Name</th><th>Cheque/DD No</th><th>Entered</th><th>By</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const isOpen = open.includes(p._id);
                  return (
                    <Fragment key={p._id}>
                      <tr className={isOpen ? "rsa-row-open" : undefined}>
                        <td>{formatDateTime(p.entryDateTime).split(",")[0]}</td>
                        <td><strong className="num">{p.paymentNumber}</strong></td>
                        <td>{money(Math.round(p.totalPayable * 100))}</td>
                        <td>{dash(p.mode)}</td>
                        <td>{dash(p.bankName)}</td>
                        <td>{dash(p.chequeNo)}</td>
                        <td>{formatDateTime(p.entryDateTime)}</td>
                        <td>{p.createdBy}</td>
                        <td>{p.paymentStatus === "ENTERED" ? "Entered" : dash(p.paymentStatus)}</td>
                        <td>
                          <button type="button" className="btn btn-outline btn-sm" aria-expanded={isOpen} aria-controls={`pay-${p._id}`} onClick={() => toggle(p._id)}>
                            {isOpen ? "Collapse ▲" : "Expand ▼"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="rsa-detail-row" id={`pay-${p._id}`}>
                          <td colSpan={10}><PaymentDetailBody p={p} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <div className="pager">
            <span className="muted">{total} payment(s) · page {page} of {pages}</span>
            <div className="inline">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Left side of the screen. Campaign dates, Payment For and entry time are display-only (no pickers). */
export function PaymentFormPanel({
  ctx, options, form, onChange,
}: { ctx: RsaContext; options: RsaOptions; form: PaymentForm; onChange: (f: PaymentForm) => void }) {
  const [diesel, setDiesel] = useState<DieselDraft>(emptyDieselDraft());
  const [draft, setDraft] = useState<ExpenseDraft>(emptyExpenseDraft(options.expenseOptions[0]?.key ?? ""));
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const t = totals(form);
  const set = <K extends keyof PaymentForm>(k: K, v: PaymentForm[K]) => onChange({ ...form, [k]: v });
  const opt = options.expenseOptions.find((o) => o.key === draft.optionKey);

  function addDiesel() {
    const e = validateDieselDraft(diesel, options.dieselPaymentModes);
    setErrors(e);
    if (e.length) return;
    set("diesel", [...form.diesel, { id: rowId(), amount: diesel.amount.trim(), mode: diesel.mode, reference: diesel.reference.trim() }]);
    setDiesel(emptyDieselDraft());
  }
  function addExpense() {
    const e = validateExpenseDraft(draft, options.expenseOptions, form.expenses, editing ?? undefined);
    setErrors(e);
    if (e.length || !opt) return;
    const row: ExpenseRow = { id: editing ?? rowId(), optionKey: opt.key, optionLabel: opt.label, description: draft.description.trim(), amount: draft.amount.trim(), deduct: draft.deduct, isDefault: draft.isDefault };
    set("expenses", editing ? form.expenses.map((x) => (x.id === editing ? row : x)) : [...form.expenses, row]);
    setDraft(emptyExpenseDraft(draft.optionKey));
    setEditing(null);
  }
  function editRow(id: string) {
    const r = form.expenses.find((x) => x.id === id);
    if (!r) return;
    setDraft({ optionKey: r.optionKey, description: r.description, amount: r.amount, deduct: r.deduct, isDefault: r.isDefault });
    setEditing(id);
    setErrors([]);
  }
  const removeRows = (ids: string[]) => {
    set("expenses", form.expenses.filter((x) => !ids.includes(x.id)));
    setSelected((s) => s.filter((x) => !ids.includes(x)));
    if (editing && ids.includes(editing)) { setEditing(null); setDraft(emptyExpenseDraft(draft.optionKey)); }
  };

  return (
    <div className="rsa-form" data-section="payment-form">
      <Errors list={errors} />
      <div className="rsa-grid">
        <label>Payment For</label>
        <Select value={ctx.paymentFor} disabled aria-label="Payment For">
          {options.paymentFor.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </Select>
        <label>From Date</label>
        <div className="rsa-ro" data-field="from-date">{ctx.campaignFromDate ? formatDate(ctx.campaignFromDate) : "—"}</div>
        <label>To Date</label>
        <div className="rsa-ro" data-field="to-date">{ctx.campaignToDate ? formatDate(ctx.campaignToDate) : "—"}</div>
        <label>Entry Date &amp; Time</label>
        <div className="rsa-ro" data-field="entry-time">{formatDateTime(ctx.entryDateTime)} <small className="muted">(recorded by the server on save)</small></div>
        <label>Cash In Hand</label>
        <label className="rsa-check"><input type="checkbox" checked={form.cashInHand} onChange={(e) => set("cashInHand", e.target.checked)} aria-label="Cash In Hand" /> Cash In Hand</label>
      </div>

      <h4 className="sub">Fuel Cost</h4>
      <div className="rsa-diesel">
        <input className="num-input" inputMode="decimal" placeholder="0.00" value={diesel.amount} aria-label="Fuel Cost" onChange={(e) => setDiesel({ ...diesel, amount: sanitizeAmount(e.target.value) })} />
        <Select value={diesel.mode} aria-label="Diesel payment mode" onChange={(e) => setDiesel({ ...diesel, mode: e.target.value })}>
          <option value="">Mode</option>
          {options.dieselPaymentModes.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <input placeholder="Reference" maxLength={120} value={diesel.reference} aria-label="Diesel reference" onChange={(e) => setDiesel({ ...diesel, reference: e.target.value.replace(/[<>]/g, "") })} />
        <button type="button" className="btn btn-outline" onClick={addDiesel} aria-label="Add diesel entry">+</button>
      </div>
      <small className="muted">The entry date &amp; time of each fuel entry is recorded by the server on save.</small>
      {form.diesel.length > 0 && (
        <ul className="rsa-chips" data-section="diesel-entries">
          {form.diesel.map((d) => (
            <li key={d.id}>
              {money(amountPaise(d.amount) ?? 0)}{d.mode ? ` · ${d.mode}` : ""}{d.reference ? ` · ${d.reference}` : ""}
              <button type="button" className="icon-btn" aria-label="Remove diesel entry" onClick={() => set("diesel", form.diesel.filter((x) => x.id !== d.id))}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="rsa-grid">
        <label>Food Allowance</label>
        <input className="num-input" inputMode="decimal" placeholder="0.00" value={form.foodAmount} aria-label="Food Allowance" onChange={(e) => set("foodAmount", sanitizeAmount(e.target.value))} />
        <label>Salary Advance</label>
        <div>
          <input className="num-input" inputMode="decimal" placeholder="0.00" value={form.salaryAdvance} aria-label="Salary Advance" onChange={(e) => set("salaryAdvance", sanitizeAmount(e.target.value))} />
          <small className="muted">Recorded only. Use Check Advance Eligibility to see the driver&apos;s advance limit.</small>
        </div>
      </div>

      <h4 className="sub">Other Expenses</h4>
      <div className="rsa-exp-entry" data-section="expense-entry">
        <Select value={draft.optionKey} aria-label="Expense Category" onChange={(e) => setDraft({ ...draft, optionKey: e.target.value })}>
          {options.expenseOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
        <input placeholder={opt?.descriptionRequired ? "Description (required)" : "Description"} maxLength={200} value={draft.description} aria-label="Expense Description"
          onChange={(e) => setDraft({ ...draft, description: e.target.value.replace(/[<>]/g, "") })} />
        <input className="num-input" inputMode="decimal" placeholder="Amount" value={draft.amount} aria-label="Expense Amount" onChange={(e) => setDraft({ ...draft, amount: sanitizeAmount(e.target.value) })} />
        <label className="rsa-check"><input type="checkbox" checked={draft.deduct} onChange={(e) => setDraft({ ...draft, deduct: e.target.checked })} aria-label="Deduct" /> Deduct</label>
        <label className="rsa-check"><input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} aria-label="Is Default" /> Is Default</label>
      </div>
      <ExpenseTable rows={form.expenses} selected={selected} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} onEdit={editRow} onDelete={(id) => removeRows([id])} />
      <div className="rsa-exp-foot">
        <button type="button" className="btn btn-primary" onClick={addExpense}>{editing ? "Update" : "Add"}</button>
        <button type="button" className="btn btn-outline" disabled={!selected.length} onClick={() => removeRows(selected)}>Delete</button>
        <label>Total</label>
        <input readOnly value={money(t.expenseNet)} aria-label="Expense Total" />
      </div>
      {overlapWarnings(form).map((w) => <p key={w} className="av-note-strong" role="note">{w}</p>)}
      <div className="rsa-payable">
        <label>Total Payable</label>
        <input readOnly value={money(t.total)} aria-label="Total Payable" className="rsa-payable-input" />
      </div>
    </div>
  );
}

export function RsaActionBar({
  onBudget, onDriver, onEligibility, onSave, onClose, busy,
}: { onBudget: () => void; onDriver: () => void; onEligibility: () => void; onSave: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <div className="rsa-actions" data-section="action-bar">
      <div className="inline">
        <button type="button" className="btn btn-outline" onClick={onBudget}>View Budget</button>
        <button type="button" className="btn btn-outline" onClick={onDriver}>View Driver</button>
        <button type="button" className="btn btn-outline" onClick={onEligibility}>Check Advance Eligibility</button>
      </div>
      <div className="inline">
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- read-only side panels
interface BudgetView {
  budgetNumber: string; approvedAmount: number; approvedVersion: number; currentVersion: number; approvedBy: string | null; approvedAt: string | null;
  versions: { version: number; total: number; updatedBy: string; createdAt: string; approved: boolean }[]; events: { version: number; action: string; username: string; role: string; createdAt: string }[];
}
export function BudgetBody({ b }: { b: BudgetView }) {
  return (
    <div data-section="budget-view">
      <dl className="kv">
        <KV k="Budget Number" v={b.budgetNumber} />
        <KV k="Approved Budget Amount" v={<strong>{money(Math.round(b.approvedAmount * 100))}</strong>} />
        <KV k="Approved Version" v={`V${b.approvedVersion}`} />
        <KV k="Approved By (RSOM)" v={b.approvedBy} />
        <KV k="Approved On" v={b.approvedAt ? formatDateTime(b.approvedAt) : null} />
      </dl>
      <h4 className="sub">Version history</h4>
      <table className="table">
        <thead><tr><th>Version</th><th>Total</th><th>Updated By</th><th>Date &amp; Time</th><th /></tr></thead>
        <tbody>{b.versions.map((v) => <tr key={v.version}><td>V{v.version}</td><td>{money(Math.round(v.total * 100))}</td><td>{v.updatedBy}</td><td>{formatDateTime(v.createdAt)}</td><td>{v.approved ? "Approved" : ""}</td></tr>)}</tbody>
      </table>
      <p className="muted">Read-only. RSA cannot change the budget.</p>
    </div>
  );
}
export function BudgetModal({ tvId, onClose }: { tvId: string; onClose: () => void }) {
  const res = useApi<BudgetView>(`/rsa/projects/${tvId}/budget`);
  return (
    <Modal title="Approved Budget" onClose={onClose} wide>
      {res.loading ? <Skeleton rows={4} /> : res.error || !res.data ? <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} /> : <BudgetBody b={res.data} />}
    </Modal>
  );
}

interface DriverView {
  driverNumber: string; driverName: string; driverType: string; mobileNumber: string; perDaySalary: number;
  bank: { accountName: string | null; bankName: string | null; accountNumberMasked: string | null; ifscCode: string | null };
  availability: { status: string | null; projectName: string | null; trackupNumber: string | null; projectFrom: string | null; projectTo: string | null } | null;
  advances: { _id: string; submittedAt: string; workingDays: number; perDaySalary: number; eligibleAdvanceAmount: number; finalAdvanceAmount: number; submittedBy: string }[];
  allotment: { vehicleNo: string | null; trackupNumber: string; allottedAt: string | null; driverAssignedAt: string | null; driverAssignedBy: string | null; driverActive: boolean; driverReleasedAt: string | null };
}
const AV: Record<string, string> = { AVAILABLE: "Available Now", IN_USE: "In Use – Another Project", NOT_AVAILABLE: "Not Available" };
export function DriverBody({ d }: { d: DriverView }) {
  return (
    <div data-section="driver-view">
      <dl className="kv">
        <KV k="Driver Number" v={<strong className="num">{d.driverNumber}</strong>} />
        <KV k="Driver Name" v={d.driverName} />
        <KV k="Driver Type" v={d.driverType === "ACTING_DRIVER" ? "Acting Driver" : "Company Driver"} />
        <KV k="Mobile Number" v={d.mobileNumber} />
        <KV k="Per Day Salary" v={d.perDaySalary > 0 ? money(Math.round(d.perDaySalary * 100)) : null} />
        <KV k="Availability" v={d.availability?.status ? AV[d.availability.status] ?? d.availability.status : null} />
      </dl>
      <h4 className="sub">Bank details</h4>
      <dl className="kv">
        <KV k="Account Holder" v={d.bank.accountName} /><KV k="Bank Name" v={d.bank.bankName} /><KV k="Account Number" v={d.bank.accountNumberMasked} /><KV k="IFSC Code" v={d.bank.ifscCode} />
      </dl>
      <h4 className="sub">Allotment</h4>
      <dl className="kv">
        <KV k="Vehicle" v={d.allotment.vehicleNo} /><KV k="Trackup Number" v={d.allotment.trackupNumber} />
        <KV k="Vehicle Allotted" v={d.allotment.allottedAt ? formatDateTime(d.allotment.allottedAt) : null} />
        <KV k="Driver Assigned" v={d.allotment.driverAssignedAt ? `${formatDateTime(d.allotment.driverAssignedAt)}${d.allotment.driverAssignedBy ? ` · ${d.allotment.driverAssignedBy}` : ""}` : null} />
        <KV k="Driver Status" v={d.allotment.driverActive ? "Assigned" : d.allotment.driverReleasedAt ? `Released ${formatDateTime(d.allotment.driverReleasedAt)}` : null} />
      </dl>
      <h4 className="sub">Advance history</h4>
      {d.advances.length === 0 ? <p className="muted">No advances yet.</p> : (
        <table className="table">
          <thead><tr><th>Date &amp; Time</th><th>Working Days</th><th>Per Day Salary</th><th>Eligible</th><th>Advance</th><th>By</th></tr></thead>
          <tbody>{d.advances.map((a) => <tr key={a._id}><td>{formatDateTime(a.submittedAt)}</td><td>{a.workingDays}</td><td>{money(Math.round(a.perDaySalary * 100))}</td><td>{money(Math.round(a.eligibleAdvanceAmount * 100))}</td><td>{money(Math.round(a.finalAdvanceAmount * 100))}</td><td>{a.submittedBy}</td></tr>)}</tbody>
        </table>
      )}
      <p className="muted">Read-only. RSA cannot edit driver records.</p>
    </div>
  );
}
export function DriverModal({ tvId, onClose }: { tvId: string; onClose: () => void }) {
  const res = useApi<DriverView>(`/rsa/projects/${tvId}/driver`);
  return (
    <Modal title="Driver Details" onClose={onClose} wide>
      {res.loading ? <Skeleton rows={5} /> : res.error || !res.data ? <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} /> : <DriverBody d={res.data} />}
    </Modal>
  );
}

interface Eligibility { driverNumber: string; driverName: string; workingDays: number; perDaySalary: number; eligibleAdvanceAmount: number; halfEligibleAmount: number; finalAdvanceAmount: number }
export function EligibilityResult({ r }: { r: Eligibility }) {
  const m = (n: number) => money(Math.round(n * 100));
  return (
    <dl className="kv" data-section="eligibility-result">
      <KV k="Driver" v={`${r.driverNumber} · ${r.driverName}`} />
      <KV k="Overall Working Days" v={r.workingDays} />
      <KV k="Per Day Salary" v={m(r.perDaySalary)} />
      <KV k="Eligible Advance Amount" v={m(r.eligibleAdvanceAmount)} />
      <KV k="Half Eligible Amount" v={m(r.halfEligibleAmount)} />
      <KV k="Final Rounded Advance Amount" v={<strong>{m(r.finalAdvanceAmount)}</strong>} />
    </dl>
  );
}
/** Calculation only: nothing is saved and no advance is created. */
export function EligibilityModal({ tvId, onClose }: { tvId: string; onClose: () => void }) {
  const [days, setDays] = useState("");
  const [res, setRes] = useState<Eligibility | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    if (!/^\d+$/.test(days) || Number(days) < 1) return setErr("Overall working days must be a positive whole number");
    setBusy(true);
    try {
      setRes(await request<Eligibility>(`/rsa/projects/${tvId}/advance-eligibility?workingDays=${days}`));
      setErr("");
    } catch (e) {
      setRes(null);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Check Advance Eligibility" onClose={onClose}>
      <Errors list={err ? [err] : []} />
      <div className="b-row">
        <label>Overall Working Days</label>
        <div className="b-ctl"><input className="num-input" inputMode="numeric" value={days} aria-label="Overall Working Days" placeholder="e.g. 10" onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} /></div>
      </div>
      {res && <EligibilityResult r={res} />}
      <p className="muted">Advance = half of (working days × per day salary), rounded down to ₹500. This only calculates; no advance is created.</p>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose}>Close</button>
        <button className="btn btn-primary" onClick={check} disabled={busy}>{busy ? "Checking…" : "Check"}</button>
      </div>
    </Modal>
  );
}

/** The complete saved payment: shown inline under a history row, or inside the modal below. */
export function PaymentDetailBody({ p }: { p: RsaPaymentRow }) {
  return (
    <div className="rsa-detail" data-section="payment-detail-body">
      <dl className="kv" data-section="payment-detail">
        <KV k="Payment Number" v={p.paymentNumber} /><KV k="Entry Date & Time" v={formatDateTime(p.entryDateTime)} /><KV k="Created By" v={p.createdBy} />
        <KV k="Trackup Number" v={p.trackupNumber} /><KV k="PIF Number" v={p.pifNumber} /><KV k="Bill Number" v={p.billNumber} /><KV k="Client / Billing Name" v={p.clientName} />
        <KV k="Campaign Period" v={p.campaignFromDate ? `${formatDate(p.campaignFromDate)} – ${p.campaignToDate ? formatDate(p.campaignToDate) : "…"}` : null} /><KV k="Vehicle" v={p.vehicleNo} /><KV k="Driver" v={[p.driverNumber, p.driverName].filter(Boolean).join(" · ")} />
        <KV k="Payment For" v={PAYMENT_FOR_LABEL[p.paymentFor] ?? p.paymentFor} /><KV k="Cash In Hand" v={p.cashInHand ? "Yes" : "No"} />
        <KV k="Food Allowance" v={money(Math.round(p.foodAmount * 100))} /><KV k="Salary Advance" v={money(Math.round(p.salaryAdvance * 100))} />
        <KV k="Diesel Total" v={money(Math.round(p.dieselTotal * 100))} /><KV k="Expenses (added)" v={money(Math.round(p.expenseTotal * 100))} /><KV k="Deductions" v={money(Math.round(p.deductTotal * 100))} /><KV k="Total Payable" v={<strong>{money(Math.round(p.totalPayable * 100))}</strong>} />
        <KV k="Status" v={p.paymentStatus === "ENTERED" ? "Entered" : p.paymentStatus} />
      </dl>
      {p.dieselEntries.length > 0 && (
        <>
          <h4 className="sub">Diesel entries</h4>
          <table className="table"><thead><tr><th>Date &amp; Time</th><th>Amount</th><th>Mode</th><th>Reference</th></tr></thead>
            <tbody>{p.dieselEntries.map((d, i) => <tr key={i}><td>{formatDateTime(d.entryAt)}</td><td>{money(Math.round(d.amount * 100))}</td><td>{dash(d.mode)}</td><td>{dash(d.reference)}</td></tr>)}</tbody></table>
        </>
      )}
      {p.expenses.length > 0 && (
        <>
          <h4 className="sub">Expenses</h4>
          <table className="table"><thead><tr><th>Detail</th><th>Description</th><th>Amount</th><th>Deduct</th></tr></thead>
            <tbody>{p.expenses.map((e, i) => <tr key={i}><td>{e.optionLabel}</td><td>{dash(e.description)}</td><td>{money(Math.round(e.amount * 100))}</td><td>{e.deduct ? "Yes" : "—"}</td></tr>)}</tbody></table>
        </>
      )}
    </div>
  );
}

/** Modal version (used on the landing history page, where no drawer is open behind it). */
export function PaymentDetail({ p, onClose }: { p: RsaPaymentRow; onClose: () => void }) {
  return (
    <Modal title={`Payment ${p.paymentNumber}`} onClose={onClose} wide>
      <PaymentDetailBody p={p} />
    </Modal>
  );
}

/**
 * Right-hand slide-in panel (the page behind it fades). Closes with the Close button, a click on the faded area or Escape.
 * Rendered only while open, so the entry form keeps the full width the rest of the time.
 */
export function RsaDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="rsa-drawer-root" data-section="history-drawer">
      <div className="rsa-scrim" onMouseDown={onClose} aria-hidden />
      <aside className="rsa-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="rsa-drawer-head">
          <h3>{title}</h3>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose} aria-label="Close payment history">Close</button>
        </div>
        <div className="rsa-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- the screen
interface HistPage { items: RsaPaymentRow[]; total: number; page: number; limit: number }

/** `onSaved`: after a successful save the caller returns to the payment history (which then reloads, newest entry on top). */
export default function RsaPaymentScreen({ tvId, onClose, onSaved }: { tvId: string; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast();
  const ctx = useApi<RsaContext>(`/rsa/projects/${tvId}`);
  const opts = useApi<RsaOptions>("/rsa/options");
  const [page, setPage] = useState(1);
  const hist = useApi<HistPage>(`/rsa/projects/${tvId}/payments?page=${page}&limit=20`);
  const [form, setForm] = useState<PaymentForm>(() => emptyPaymentForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "budget" | "driver" | "eligibility">(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const key = useRef(newSubmissionKey()); // one key per form session: double-click / retry can only ever save once
  const inflight = useRef(false);

  if (ctx.loading || opts.loading) return <Skeleton rows={8} />;
  if (ctx.error || !ctx.data) return <ErrorState message={ctx.error ?? "Project not found"} onRetry={ctx.reload} />;
  if (opts.error || !opts.data) return <ErrorState message={opts.error ?? "Options could not be loaded"} onRetry={opts.reload} />;
  const c = ctx.data;
  const t = totals(form);

  function review() {
    const e = validatePaymentForm(form);
    setErrors(e);
    if (!e.length) setConfirm(true);
  }
  async function save() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const saved = await request<RsaPaymentRow>(`/rsa/projects/${tvId}/payments`, "POST", toPaymentPayload(form, c.paymentFor, key.current));
      toast(`Payment ${saved.paymentNumber} saved`);
      if (onSaved) {
        onSaved();
        return;
      }
      key.current = newSubmissionKey(); // the next entry is a new submission
      setForm(emptyPaymentForm());
      setConfirm(false);
      setErrors([]);
      setPage(1);
      hist.reload();
      ctx.reload();
    } catch (e) {
      setErrors([(e as Error).message]);
      setConfirm(false);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="rsa-screen">
      <div className="rsa-top">
        <ProjectHeader ctx={c} />
        <button type="button" className="btn btn-outline rsa-history-btn" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">
          Payment History{hist.data ? <span className="rsa-count">{hist.data.total}</span> : null}
        </button>
      </div>
      <div className="card rsa-full">
        <Errors list={errors} />
        <PaymentFormPanel ctx={c} options={opts.data} form={form} onChange={setForm} />
      </div>
      <RsaActionBar onBudget={() => setPanel("budget")} onDriver={() => setPanel("driver")} onEligibility={() => setPanel("eligibility")} onSave={review} onClose={onClose} busy={busy} />
      {confirm && (
        <Modal title="Confirm Payment" onClose={() => setConfirm(false)}>
          <dl className="kv allot-proj" data-step="summary">
            <KV k="Trackup Number" v={c.trackupNumber} /><KV k="PIF Number" v={c.pifNumber} /><KV k="Vehicle" v={c.vehicle.vehicleNo} /><KV k="Driver" v={`${c.driver.driverNumber} · ${c.driver.driverName}`} />
            <KV k="Payment For" v={PAYMENT_FOR_LABEL[c.paymentFor]} /><KV k="Cash In Hand" v={form.cashInHand ? "Yes" : "No"} />
            <KV k="Fuel Cost" v={money(t.diesel)} /><KV k="Food Allowance" v={money(amountPaise(form.foodAmount) ?? 0)} /><KV k="Salary Advance" v={money(amountPaise(form.salaryAdvance) ?? 0)} />
            <KV k="Expenses (net)" v={money(t.expenseNet)} /><KV k="Total Payable" v={<strong>{money(t.total)}</strong>} />
          </dl>
          <p className="muted">The payment number, entry time and amounts are recorded by the server. Saving an entry does not mean the bank transfer is done.</p>
          <div className="actions-row">
            <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Back</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Confirm & Save"}</button>
          </div>
        </Modal>
      )}
      {historyOpen && (
        <RsaDrawer title="Payment History" onClose={() => setHistoryOpen(false)}>
          {hist.loading ? <Skeleton rows={5} /> : hist.error || !hist.data ? <ErrorState message={hist.error ?? "History could not be loaded"} onRetry={hist.reload} /> : (
            <PaymentHistoryTable items={hist.data.items} total={hist.data.total} page={page} limit={hist.data.limit} onPage={setPage} />
          )}
        </RsaDrawer>
      )}
      {panel === "budget" && <BudgetModal tvId={tvId} onClose={() => setPanel(null)} />}
      {panel === "driver" && <DriverModal tvId={tvId} onClose={() => setPanel(null)} />}
      {panel === "eligibility" && <EligibilityModal tvId={tvId} onClose={() => setPanel(null)} />}
    </div>
  );
}
