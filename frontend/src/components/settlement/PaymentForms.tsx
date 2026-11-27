"use client";

import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { request } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";
import { earlierOf, keepInRange, laterOf } from "@/utils/dates";
import { amountPaise, money, newSubmissionKey, rowId, sanitizeAmount, type RsaProjectRow } from "@/utils/rsa";
import { allowanceText, kmText, kmUsage } from "@/utils/kmAllowance";
import {
  DEDUCTION_KEYS, campaignDays, travelPayPaise, onRoadBase, paymentsBase, finalFormFrom, finalPayload, finalTotals, validateFinalForm, type FinalForm, type FinalNumberKey, type SettlementContext, type SettlementDetail, type SettlementOptions,
} from "@/utils/settlement";

const d = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v));

// ------------------------------------------------------------------------------------------------ project picker

export function ProjectPicker({ kind }: { kind: "daily" | "final" }) {
  const base = paymentsBase(useAuth().user?.role);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const list = useApi<{ items: RsaProjectRow[]; total: number; page: number; limit: number }>(`/settlements/projects?q=${encodeURIComponent(dq)}&page=${page}&limit=10${kind === "final" ? "&kind=final" : ""}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / 10)) : 1;
  return (
    <div className="card ds-card">
      <div className="ds-toolbar">
        <input className="ds-search" placeholder="Search trackup / PIF no, client, vehicle, driver" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search projects" />
      </div>
      {list.loading ? <Skeleton rows={5} /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data?.items.length ? (
        <EmptyState title="No eligible projects" hint={`A project appears here once RSOM approves its budget and a vehicle and driver are allotted.${kind === "final" ? " Vehicles whose driver already has a final settlement are not listed." : ""}`} />
      ) : (
        <>
          <TableWrap>
            <table className="table ds-table">
              <thead><tr><th>Trackup No</th><th>Client</th><th>Type</th><th>Vehicle</th><th>Driver</th><th>Campaign</th><th>Approved Budget</th><th /></tr></thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.trackingVehicle}>
                    <td><strong className="num">{p.trackupNumber}</strong><br /><small className="muted">{p.pifNumber}</small></td>
                    <td>{p.clientName}</td>
                    <td>{p.projectType === "ROADSHOW" ? "RoadShow" : "Signage"}</td>
                    <td>{d(p.vehicleNo)}</td>
                    <td>{d(p.driverName)}<br /><small className="muted">{d(p.driverNumber)}</small></td>
                    <td className="ds-nowrap">{formatDate(p.campaignFromDate)}<br /><small className="muted">to {formatDate(p.campaignToDate)}</small></td>
                    <td className="ds-amt">{formatInr(p.approvedBudgetAmount)}</td>
                    <td><Link className="btn btn-primary btn-sm" href={`${base}/${kind}?tv=${p.trackingVehicle}`}>Select</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="pager">
            <span className="muted">{list.data.total} project(s) · page {page} of {pages}</span>
            <div className="inline">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ context header + side panels

const Row = ({ k, v }: { k: string; v: ReactNode }) => <div><dt>{k}</dt><dd>{v === null || v === undefined || v === "" ? "-" : v}</dd></div>;

function BudgetPanel({ tv, onClose }: { tv: string; onClose: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = useApi<any>(`/settlements/projects/${tv}/budget`);
  return (
    <Modal title="Approved Budget" onClose={onClose} wide>
      {b.loading ? <Skeleton /> : b.error ? <ErrorState message={b.error} /> : b.data && (
        <>
          <dl className="ds-kv">
            <Row k="Budget No" v={b.data.budgetNumber} /><Row k="Approved Amount" v={formatInr(b.data.approvedAmount)} /><Row k="Approved Version" v={`V${b.data.approvedVersion}`} />
            <Row k="Approved By" v={`${d(b.data.approvedBy)} · ${formatDateTime(b.data.approvedAt)}`} />
            <Row k="Mileage" v={b.data.data?.mileage} /><Row k="Est. KM / Day" v={b.data.data?.estimatedKmPerDay} /><Row k="Days" v={b.data.data?.numberOfDays} />
            <Row k="Diesel" v={formatInr(b.data.data?.dieselAmount)} /><Row k="Salary" v={`${formatInr(b.data.data?.salaryAmount)} ${b.data.data?.salaryUnit === "PER_CAMPAIGN" ? "per campaign" : "per day"}`} />
            <Row k="Food" v={`${formatInr(b.data.data?.foodAmount)} ${b.data.data?.foodUnit === "PER_CAMPAIGN" ? "per campaign" : "per day"}`} /><Row k="Halt Food" v={formatInr(b.data.data?.haltFood)} /><Row k="Total KM" v={b.data.data?.totalKm} />
          </dl>
          <h4 className="ds-h4">Versions</h4>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <ul className="ds-list">{b.data.versions.map((v: any) => <li key={v.version}>V{v.version} · {formatInr(v.total)} · {v.updatedBy} · {formatDateTime(v.createdAt)}{v.approved && <b> · approved</b>}</li>)}</ul>
        </>
      )}
    </Modal>
  );
}

function DriverPanel({ tv, onClose }: { tv: string; onClose: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = useApi<any>(`/settlements/projects/${tv}/driver`);
  return (
    <Modal title="Driver" onClose={onClose} wide>
      {r.loading ? <Skeleton /> : r.error ? <ErrorState message={r.error} /> : r.data && (
        <>
          <dl className="ds-kv">
            <Row k="Driver" v={`${r.data.driverName} (${r.data.driverNumber})`} /><Row k="Type" v={r.data.driverType} /><Row k="Mobile" v={r.data.mobileNumber} />
            <Row k="Per Day Salary" v={formatInr(r.data.perDaySalary)} /><Row k="Bank" v={r.data.bank.bankName} /><Row k="Account" v={r.data.bank.accountNumberMasked} /><Row k="IFSC" v={r.data.bank.ifscCode} />
            <Row k="Allotted" v={formatDateTime(r.data.allotment.driverAssignedAt)} />
          </dl>
          <h4 className="ds-h4">Advances</h4>
          {r.data.advances.length ? (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <ul className="ds-list">{r.data.advances.map((a: any) => <li key={a._id}>{formatDateTime(a.submittedAt)} · {a.workingDays} days · {formatInr(a.finalAdvanceAmount)} · {a.submittedBy}</li>)}</ul>
          ) : <p className="muted">No advances recorded.</p>}
        </>
      )}
    </Modal>
  );
}

function AdvancePanel({ tv, onClose }: { tv: string; onClose: () => void }) {
  const [days, setDays] = useState("");
  const [res, setRes] = useState<null | { workingDays: number; perDaySalary: number; eligibleAdvanceAmount: number; finalAdvanceAmount: number }>(null);
  const [err, setErr] = useState("");
  const check = async () => {
    setErr("");
    setRes(null);
    try {
      setRes(await request(`/settlements/projects/${tv}/advance-eligibility?workingDays=${encodeURIComponent(days)}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Modal title="Check Advance Eligibility" onClose={onClose}>
      <p className="muted">Uses the same rule as Driver Advance. Nothing is saved.</p>
      <div className="inline ds-gap">
        <input inputMode="numeric" placeholder="Overall working days" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label="Working days" />
        <button type="button" className="btn btn-primary" disabled={!days} onClick={check}>Check</button>
      </div>
      {err && <div className="alert">{err}</div>}
      {res && <dl className="ds-kv"><Row k="Working days" v={res.workingDays} /><Row k="Per day salary" v={formatInr(res.perDaySalary)} /><Row k="Eligible" v={formatInr(res.eligibleAdvanceAmount)} /><Row k="Advance allowed" v={<b>{formatInr(res.finalAdvanceAmount)}</b>} /></dl>}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ shared field helpers

function useEntry(tv: string | null, id: string | null) {
  const ctx = useApi<SettlementContext>(tv ? `/settlements/projects/${tv}` : null);
  const existing = useApi<SettlementDetail>(id ? `/settlements/${id}` : null);
  return { ctx, existing };
}

// ------------------------------------------------------------------------------------------------ daily vehicle payment

interface DailyRow { id: string; optionKey: string; description: string; amount: string; deduct: boolean }

export function DailyPaymentForm({ tv, id }: { tv: string; id: string | null }) {
  const { ctx, existing } = useEntry(tv, id);
  const opts = useApi<SettlementOptions>("/settlements/options").data;
  if (ctx.loading || existing.loading) return <Skeleton rows={8} />;
  if (ctx.error) return <ErrorState message={ctx.error} />;
  if (existing.error) return <ErrorState message={existing.error} />;
  if (!ctx.data) return null;
  return <DailyInner key={existing.data?._id ?? "new"} ctx={ctx.data} existing={existing.data} expenseOptions={opts?.dailyExpenseOptions ?? DEFAULT_EXPENSES} />;
}
const DEFAULT_EXPENSES = [
  { key: "OTHERS", label: "Others", descriptionRequired: true }, { key: "FUEL", label: "Fuel" }, { key: "FLEET_BALANCE", label: "Fleet Balance" }, { key: "TOLL", label: "Toll" },
  { key: "FOOD_ALLOWANCE", label: "Food Allowance" }, { key: "TRAVEL", label: "Travel" }, { key: "PERMIT", label: "Permit" }, { key: "SERVICE", label: "Service" },
];

interface DieselLine { id: string; amount: string; bunk: string; date: string }

/** Daily Vehicle Payment, laid out like the legacy "VEHICLE PAYMENT" window: entry form left, job details + previous payments right. */
function DailyInner({ ctx, existing, expenseOptions }: { ctx: SettlementContext; existing: SettlementDetail | null; expenseOptions: { key: string; label: string; descriptionRequired?: boolean }[] }) {
  const router = useRouter();
  const role = useAuth().user?.role;
  // opened from On Road Vehicles: Back and the redirect after saving return there; otherwise to Driver Payments as before
  const fromOnRoad = useSearchParams().get("from") === "on-road";
  const base = fromOnRoad ? onRoadBase(role) : paymentsBase(role);
  const toast = useToast();
  const s = existing?.data;
  const [today] = useState(() => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const paymentFor = ctx.projectType;
  // The payment period lies inside the campaign; today is the default only while the campaign is running.
  const campFrom = ctx.campaign.fromDate || undefined;
  const campTo = ctx.campaign.toDate || undefined;
  const defaultDay = keepInRange(today, campFrom, campTo);
  const [fromDate, setFromDate] = useState<string>(s?.fromDate ?? defaultDay);
  const [toDate, setTo] = useState<string>(s?.toDate ?? defaultDay);
  const [periodNote, setPeriodNote] = useState("");
  const setFrom = (v: string) => {
    setFromDate(v);
    if (toDate && v && toDate < v) {
      setTo("");
      setPeriodNote("To Date was cleared because it is before the new From Date. Pick it again.");
    } else setPeriodNote("");
  };
  const dieselMax = earlierOf(toDate, today);
  const [cashInHand, setCash] = useState<boolean>(!!s?.cashInHand);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [diesel, setDiesel] = useState<DieselLine[]>((s?.dieselEntries ?? []).map((x: any) => ({ id: rowId(), amount: String(x.amount), bunk: x.reference ?? "", date: "" })));
  const [dDraft, setDDraft] = useState({ amount: "", bunk: "", date: defaultDay });
  const [food, setFood] = useState<string>(s?.foodAmount ? String(s.foodAmount) : "");
  const [advance, setAdvance] = useState<string>(s?.salaryAdvance ? String(s.salaryAdvance) : "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows, setRows] = useState<(DailyRow & { isDefault: boolean })[]>((s?.expenses ?? []).map((e: any) => ({ id: rowId(), optionKey: e.optionKey, description: e.description ?? "", amount: String(e.amount), deduct: !!e.deduct, isDefault: !!e.isDefault })));
  const [xDraft, setXDraft] = useState({ optionKey: "OTHERS", description: "", amount: "", isDefault: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "budget" | "driver" | "advance">(null);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const key = useRef(newSubmissionKey());

  const p = (x: string) => amountPaise(x) ?? 0;
  const dieselTotal = diesel.reduce((t, r) => t + p(r.amount), 0);
  const add = rows.filter((r) => !r.deduct).reduce((t, r) => t + p(r.amount), 0);
  const ded = rows.filter((r) => r.deduct).reduce((t, r) => t + p(r.amount), 0);
  const total = dieselTotal + p(food) + p(advance) + add;
  const payable = total - ded; // existing rule: diesel + food + salary advance + expenses - expenses marked Deduct

  const addDiesel = () => {
    const e: string[] = [];
    if (!p(dDraft.amount)) e.push("Enter the fuel cost");
    if (!dDraft.bunk.trim()) e.push("Enter the diesel / petrol bunk name");
    if (/[<>]/.test(dDraft.bunk)) e.push("Bunk name contains invalid characters");
    if (dDraft.date) {
      if (dDraft.date > today) e.push("Diesel date cannot be in the future");
      else if ((fromDate && dDraft.date < fromDate) || (toDate && dDraft.date > toDate)) e.push("Diesel date must be within the payment From and To dates");
    }
    if (e.length) return setErrors(e);
    setErrors([]);
    setDiesel([...diesel, { id: rowId(), amount: dDraft.amount, bunk: dDraft.bunk.trim(), date: dDraft.date }]);
    setDDraft({ amount: "", bunk: "", date: dDraft.date });
  };
  const addExpense = () => {
    const o = expenseOptions.find((x) => x.key === xDraft.optionKey);
    const e: string[] = [];
    if (!o) e.push("Choose an expense detail");
    if (o?.descriptionRequired && !xDraft.description.trim()) e.push(`Description is required for ${o.label}`);
    if (!p(xDraft.amount)) e.push("Amount must be greater than zero");
    const sig = (r: { optionKey: string; description: string; amount: string }) => `${r.optionKey}|${r.description.trim().toLowerCase()}|${p(r.amount)}`;
    if (rows.some((r) => !r.deduct && sig(r) === sig(xDraft))) e.push("This expense is already added");
    if (e.length) return setErrors(e);
    setErrors([]);
    setRows([...rows, { id: rowId(), optionKey: xDraft.optionKey, description: xDraft.description.trim(), amount: xDraft.amount, deduct: false, isDefault: xDraft.isDefault }]);
    setXDraft({ optionKey: xDraft.optionKey, description: "", amount: "", isDefault: false });
  };
  const deleteSelected = () => {
    if (!selected) return setErrors(["Select a row in the table to delete"]);
    setRows(rows.filter((r) => r.id !== selected));
    setDiesel(diesel.filter((r) => r.id !== selected));
    setSelected(null);
  };

  const submit = async () => {
    const e: string[] = [];
    if (!fromDate || !toDate) e.push("From Date and To Date are required");
    else if (toDate < fromDate) e.push("To Date cannot be before From Date");
    else if (!(s && fromDate === s.fromDate && toDate === s.toDate)) {
      // same rule as the server; an unchanged period of a payment being corrected is accepted
      if (campFrom && fromDate < campFrom) e.push("From Date cannot be before the campaign start date");
      if (campTo && toDate > campTo) e.push("To Date cannot be after the campaign end date");
    }
    if (diesel.some((r) => r.date && (r.date > today || r.date < fromDate || r.date > toDate))) e.push("Every diesel date must be within the payment period and not in the future");
    for (const [label, v] of [["Food", food], ["Salary Advance", advance]] as const) if (amountPaise(v) === null) e.push(`${label} must contain digits only`);
    if (p(dDraft.amount)) e.push("Click + to add the fuel cost entered, or clear it");
    if (!total) e.push("Enter at least one amount");
    if (payable < 0) e.push("The deductions are more than the payable amount");
    setErrors(e);
    if (e.length) return;
    setBusy(true);
    const body = {
      paymentFor, fromDate, toDate, cashInHand, foodAmount: food.trim(), salaryAdvance: advance.trim(), idempotencyKey: key.current,
      dieselEntries: diesel.map((r) => ({ amount: r.amount.trim(), mode: cashInHand ? "Cash" : undefined, reference: `${r.bunk}${r.date ? ` · ${formatDate(r.date)}` : ""}`.slice(0, 120) })),
      expenses: rows.map((r) => ({ optionKey: r.optionKey, description: r.description.trim() || undefined, amount: r.amount.trim(), deduct: r.deduct, isDefault: r.isDefault })),
    };
    try {
      const saved = existing
        ? await request<SettlementDetail>(`/settlements/${existing._id}/resubmit`, "POST", { ...body, comment: comment.trim() || undefined })
        : await request<SettlementDetail>(`/settlements/projects/${ctx.trackingVehicle}/daily`, "POST", body);
      toast(`${saved.paymentNumber} saved and sent to RSOM for approval`);
      router.push(base);
    } catch (x) {
      setErrors([(x as Error).message]);
      setBusy(false);
    }
  };

  const label = (k: string) => expenseOptions.find((o) => o.key === k)?.label ?? k;
  const history = ctx.previousPayments ?? [];
  // unsaved entries are protected against reload / tab close / Close (not after a successful save)
  const dirty = !busy && (diesel.length > 0 || rows.length > 0 || !!food.trim() || !!advance.trim() || !!dDraft.amount.trim() || !!xDraft.amount.trim() || !!comment.trim());
  const confirmLeave = useUnsavedChanges(dirty);

  return (
    <div className="dsf vp">
      <div className="dsf-title"><span>VEHICLE PAYMENT</span><Link className="dsf-back" href={base} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>{fromOnRoad ? "← Back to on road vehicles" : "← Back to driver payments"}</Link></div>
      {existing && <div className="alert">Correcting {existing.paymentNumber} (rejected: {existing.rejectionReason}). Saving creates version {existing.version + 1}.</div>}
      <div className="vp-body">
        {/* ---------------- left: entry form */}
        <div className="vp-left">
          <div className="vp-grid">
            <label>Payment For</label>
            <Select className="dsf-in" value={paymentFor} disabled aria-label="Payment For"><option value="ROADSHOW">RoadShow</option><option value="SIGNAGE">Signage</option></Select>
            <label>From Date</label>
            <DateInput className="dsf-in dsf-w-date" value={fromDate} min={campFrom} max={campTo} onChange={(e) => setFrom(e.target.value)} aria-label="From Date" />
            <label>To Date</label>
            <span className="vp-inline">
              <DateInput className="dsf-in dsf-w-date" value={toDate} min={laterOf(fromDate, campFrom)} max={campTo} onChange={(e) => { setTo(e.target.value); setPeriodNote(""); }} aria-label="To Date" />
              <label className="vp-check"><input type="checkbox" checked={cashInHand} onChange={(e) => setCash(e.target.checked)} /> Cash In Hand</label>
            </span>
            {(periodNote || campFrom) && <><span /><small className={periodNote ? "toll-warn" : "muted"} role="status">{periodNote || `Campaign ${formatDate(campFrom)} → ${formatDate(campTo)}`}</small></>}
            <label>Fuel Cost</label>
            <span className="vp-inline">
              <input className="dsf-in num-input dsf-w-s" inputMode="decimal" placeholder="0.00" aria-label="Fuel cost" value={dDraft.amount} onChange={(e) => setDDraft({ ...dDraft, amount: sanitizeAmount(e.target.value) })} />
              <input className="dsf-in vp-bunk" placeholder="Diesel / petrol bunk name" aria-label="Bunk name" maxLength={90} value={dDraft.bunk} onChange={(e) => setDDraft({ ...dDraft, bunk: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addDiesel()} />
              <button type="button" className="dsf-btn dsf-btn-plain vp-plus" onClick={addDiesel} aria-label="Add diesel entry">+</button>
              <DateInput className="dsf-in dsf-w-date" aria-label="Diesel date" value={dDraft.date} min={fromDate || campFrom} max={dieselMax} onChange={(e) => setDDraft({ ...dDraft, date: e.target.value })} />
            </span>
            <label>Food</label>
            <span className="vp-inline">
              <input className="dsf-in num-input dsf-w-s" inputMode="decimal" placeholder="0.00" aria-label="Food" value={food} onChange={(e) => setFood(sanitizeAmount(e.target.value))} />
              <label className="vp-lbl">Salary Advance</label>
              <input className="dsf-in num-input dsf-w-s" inputMode="decimal" placeholder="0.00" aria-label="Salary Advance" value={advance} onChange={(e) => setAdvance(sanitizeAmount(e.target.value))} />
            </span>
          </div>

          <div className="vp-exp">
            <div className="vp-exp-entry">
              <Select className="dsf-in" aria-label="Expense detail" value={xDraft.optionKey} onChange={(e) => setXDraft({ ...xDraft, optionKey: e.target.value })}>
                {["FUEL", "FLEET_BALANCE", "TOLL", "FOOD_ALLOWANCE", "TRAVEL", "PERMIT", "SERVICE", "OTHERS"].filter((k) => expenseOptions.some((o) => o.key === k)).map((k) => <option key={k} value={k}>{label(k)}</option>)}
              </Select>
              <input className="dsf-in" placeholder="Description" aria-label="Expense description" maxLength={200} value={xDraft.description} onChange={(e) => setXDraft({ ...xDraft, description: e.target.value })} />
              <input className="dsf-in num-input" placeholder="Amount" inputMode="decimal" aria-label="Expense amount" value={xDraft.amount} onChange={(e) => setXDraft({ ...xDraft, amount: sanitizeAmount(e.target.value) })} onKeyDown={(e) => e.key === "Enter" && addExpense()} />
              <label className="vp-check"><input type="checkbox" checked={xDraft.isDefault} onChange={(e) => setXDraft({ ...xDraft, isDefault: e.target.checked })} /> Is Default</label>
            </div>
            <div className="vp-table">
              <table>
                <thead><tr><th>DETAIL</th><th>DESCRIPTION</th><th className="ds-amt">AMOUNT</th><th>DEDUCT</th></tr></thead>
                <tbody>
                  {diesel.map((r) => (
                    <tr key={r.id} className={selected === r.id ? "sel" : ""} onClick={() => setSelected(r.id)}>
                      <td>Diesel</td><td>{r.bunk}{r.date ? ` · ${formatDate(r.date)}` : ""}</td><td className="ds-amt">{money(p(r.amount))}</td><td />
                    </tr>
                  ))}
                  {rows.map((r) => (
                    <tr key={r.id} className={selected === r.id ? "sel" : ""} onClick={() => setSelected(r.id)}>
                      <td>{label(r.optionKey)}{r.isDefault && <small className="muted"> (default)</small>}</td><td>{r.description || "-"}</td>
                      <td className="ds-amt">{r.deduct ? "−" : ""}{money(p(r.amount))}</td>
                      <td><input type="checkbox" aria-label="Deduct" checked={r.deduct} onClick={(e) => e.stopPropagation()} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, deduct: e.target.checked } : x)))} /></td>
                    </tr>
                  ))}
                  {!diesel.length && !rows.length && <tr><td colSpan={4} className="dsf-empty">Add diesel with + and expenses with Add</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="vp-exp-foot">
              <button type="button" className="dsf-btn dsf-btn-blue" onClick={addExpense}>Add</button>
              <button type="button" className="dsf-btn dsf-btn-red" onClick={deleteSelected} disabled={!selected}>Delete</button>
              <label>Total</label><input className="dsf-in dsf-ro num-input" readOnly tabIndex={-1} value={money(total)} />
            </div>
          </div>
          <div className="vp-payable"><label>Total Payable</label><input className={`dsf-in dsf-ro num-input${payable < 0 ? " dsf-neg" : ""}`} readOnly tabIndex={-1} value={money(payable)} /></div>
          {existing && <div className="vp-payable"><label>Resubmission note</label><input className="dsf-in dsf-grow" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What was corrected" /></div>}
        </div>

        {/* ---------------- right: job details + previous payments */}
        <div className="vp-right">
          <div className="vp-job">
            <div className="vp-job-lines">
              <div>JobSheet No: <b>{ctx.campaign.jsNumber ?? ctx.trackupNumber}</b></div>
              <div>PIF No: <b>{ctx.pifNumber}</b></div>
              <div>Vehicle No: <b>{ctx.vehicleNo}</b></div>
              <div>Client Name: <b>{ctx.clientName}</b></div>
              <div>Driver Name: <b>{ctx.driverName}</b></div>
              {ctx.campaign.km && ctx.campaign.km.totalAllowedKm !== null && <div>Total Allowed KM: <b>{allowanceText(ctx.campaign.km)}</b></div>}
            </div>
            <div className="vp-payno">Payment No: <b>{existing?.paymentNumber ?? "Auto on save"}</b></div>
          </div>
          <div className="vp-hist">
            <table>
              <thead><tr><th>Date</th><th className="ds-amt">Amount</th><th>Mode</th><th>Bank Name</th></tr></thead>
              <tbody>
                {history.length === 0 && <tr><td colSpan={4} className="dsf-empty">No previous payments for this vehicle</td></tr>}
                {history.map((h) => (
                  <tr key={`${h.source}-${h.paymentNumber}`} title={`${h.paymentNumber} · ${h.status}`}>
                    <td>{formatDate(h.date)}</td><td className="ds-amt">{(Number(h.amount) || 0).toFixed(2)}</td><td>{h.mode}</td><td>{d(h.bankName)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {errors.length > 0 && <div className="alert" role="alert">{errors.map((x) => <div key={x}>{x}</div>)}</div>}
      <div className="dsf-actions">
        <button type="button" className="dsf-btn dsf-btn-amber" onClick={() => setPanel("budget")}>View Budget</button>
        <button type="button" className="dsf-btn dsf-btn-amber" onClick={() => setPanel("driver")}>View Driver</button>
        <button type="button" className="dsf-btn dsf-btn-amber" onClick={() => setPanel("advance")}>Check Advance Eligiblity</button>
        <span className="topbar-spacer" />
        <button type="button" className="dsf-btn dsf-btn-pink" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save"}</button>
        <Link className="dsf-btn dsf-btn-plain" href={base} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>Close</Link>
      </div>
      {panel === "budget" && <BudgetPanel tv={ctx.trackingVehicle} onClose={() => setPanel(null)} />}
      {panel === "driver" && <DriverPanel tv={ctx.trackingVehicle} onClose={() => setPanel(null)} />}
      {panel === "advance" && <AdvancePanel tv={ctx.trackingVehicle} onClose={() => setPanel(null)} />}
    </div>
  );
}
// ------------------------------------------------------------------------------------------------ final driver salary & expenses

export function FinalSettlementForm({ tv, id }: { tv: string; id: string | null }) {
  const { ctx, existing } = useEntry(tv, id);
  const opts = useApi<SettlementOptions>("/settlements/options");
  if (ctx.loading || existing.loading || opts.loading) return <Skeleton rows={10} />;
  if (ctx.error) return <ErrorState message={ctx.error} />;
  if (existing.error) return <ErrorState message={existing.error} />;
  if (!ctx.data || !opts.data) return null;
  return <FinalInner key={existing.data?._id ?? "new"} ctx={ctx.data} existing={existing.data} opts={opts.data} />;
}

/**
 * Final Driver Salary & Expenses, laid out like the legacy "DRIVER SALARY AND EXPENSES" screen:
 * header (RoadShow detail | driver detail | bank), salary & fuel block (left), expense claims (right), deductions + net (bottom).
 * Every figure is prefilled from saved records and recalculated on each change; the server recalculates again on save.
 */
function FinalInner({ ctx, existing, opts }: { ctx: SettlementContext; existing: SettlementDetail | null; opts: SettlementOptions }) {
  const router = useRouter();
  const base = paymentsBase(useAuth().user?.role);
  const toast = useToast();
  const [f, setF] = useState<FinalForm>(() => finalFormFrom(ctx, existing?.data ?? null));
  const [initialForm] = useState(() => JSON.stringify(finalFormFrom(ctx, existing?.data ?? null)));
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "suspense" | "closing" | "onroad" | "travel">(null);
  const [draft, setDraft] = useState({ category: "", description: "", quantity: "1", cost: "" });
  const [draftErr, setDraftErr] = useState("");
  const [entryDate] = useState(() => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const key = useRef(newSubmissionKey());
  const t = useMemo(() => finalTotals(f), [f]);
  const km = ctx.campaign.km ? kmUsage(ctx.campaign.km, t.resultKm) : null; // the server recalculates and saves the same figures
  // the settlement's own campaign period (the project's dates until changed here)
  const period = (from: string, to: string) => campaignDays({ campaign: { ...ctx.campaign, fromDate: from, toDate: to } });
  const days = period(f.campaignFrom, f.campaignTo);
  const periodChanged = f.campaignFrom !== (ctx.campaign.fromDate ?? "") || f.campaignTo !== (ctx.campaign.toDate ?? "");
  const setPeriod = (campaignFrom: string, campaignTo: string) => {
    const next = period(campaignFrom, campaignTo);
    setF({
      ...f, campaignFrom, campaignTo,
      n: next ? { ...f.n, onRoadDays: String(next.onRoadDays || ""), onRoadSundays: String(next.onRoadSundays || "") } : f.n,
    });
  };
  const travelUsed = !!(amountPaise(f.n.travelKm) || amountPaise(f.n.travelRate));
  // once KM / rate are touched the amount is theirs alone: a previously typed amount is dropped
  const setTravel = (k: "travelKm" | "travelRate", v: string) => setF({ ...f, n: { ...f.n, travelPay: "", [k]: v } });
  const pv = (s: string) => amountPaise(s) ?? 0;
  const setN = (k: FinalNumberKey, v: string) => setF({ ...f, n: { ...f.n, [k]: v } });
  const setD = (k: (typeof DEDUCTION_KEYS)[number], v: string) => setF({ ...f, deductions: { ...f.deductions, [k]: v } });
  const blocked = !existing && ctx.existingFinal;
  const isRoadshow = ctx.projectType === "ROADSHOW";

  // plain render helpers (not components), so inputs keep focus while typing
  const num = (k: FinalNumberKey, o: { placeholder?: string; w?: string } = {}) => (
    <input key={k} className={`dsf-in num-input${o.w ? ` ${o.w}` : ""}`} inputMode="decimal" aria-label={o.placeholder ?? k} placeholder={o.placeholder} value={f.n[k]} onChange={(e) => setN(k, sanitizeAmount(e.target.value))} />
  );
  const ro = (v: string, w?: string) => <input className={`dsf-in dsf-ro num-input${w ? ` ${w}` : ""}`} value={v} readOnly tabIndex={-1} />;

  const addExpense = () => {
    const cat = opts.finalExpenseCategories.find((c) => c.key === draft.category);
    const e: string[] = [];
    if (!cat) e.push("Choose an expense category");
    if (cat?.descriptionRequired && !draft.description.trim()) e.push(`Enter the details for ${cat.label}`);
    if (!pv(draft.quantity)) e.push("Quantity / hours / days must be greater than zero");
    if (!pv(draft.cost)) e.push("Cost must be greater than zero");
    const sig = `${draft.category}|${draft.description.trim().toLowerCase()}`;
    if (f.expenses.some((x) => `${x.category}|${x.description.trim().toLowerCase()}` === sig)) e.push("This expense is already added");
    if (e.length) return setDraftErr(e.join("; "));
    setDraftErr("");
    setF({ ...f, expenses: [...f.expenses, { id: rowId(), category: draft.category, description: draft.description.trim(), quantity: draft.quantity, cost: draft.cost, approved: "" }] });
    setDraft({ category: "", description: "", quantity: "1", cost: "" });
  };

  const submit = async () => {
    const e = validateFinalForm(f, days?.calendar ?? null);
    setErrors(e);
    if (e.length) return;
    setBusy(true);
    try {
      const body = finalPayload(f, key.current);
      const saved = existing
        ? await request<SettlementDetail>(`/settlements/${existing._id}/resubmit`, "POST", { ...body, comment: comment.trim() || undefined })
        : await request<SettlementDetail>(`/settlements/projects/${ctx.trackingVehicle}/final`, "POST", body);
      toast(`${saved.paymentNumber} saved and sent to RSO for approval`);
      router.push(base);
    } catch (x) {
      setErrors([(x as Error).message]);
      setBusy(false);
    }
  };

  const earn = (label: string) => t.earnings.find((e) => e.label === label)?.amount ?? 0;
  const dirty = !busy && (JSON.stringify(f) !== initialForm || !!comment.trim() || !!draft.cost.trim());
  const confirmLeave = useUnsavedChanges(dirty);
  const perDayTotal = pv(f.n.perDaySalary) + pv(f.n.perDayFood);

  return (
    <div className="dsf fsf">
      <header className="dsf-title fsf-head">
        <div>
          <span>DRIVER SALARY AND EXPENSES</span>
          <small>{[f.jsNumber || ctx.trackupNumber, ctx.pifNumber, ctx.clientName, ctx.vehicleNo, existing?.paymentNumber].filter(Boolean).join("  ·  ")}</small>
        </div>
        <Link className="dsf-back" href={base} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>← Back to driver payments</Link>
      </header>
      {blocked && <div className="alert">A final settlement ({ctx.existingFinal!.paymentNumber}, {ctx.existingFinal!.status.toLowerCase()}) already exists for this driver on this vehicle. Only one final settlement is allowed.</div>}
      {existing && <div className="alert">Correcting {existing.paymentNumber} (rejected: {existing.rejectionReason}). Saving creates version {existing.version + 1}.</div>}

      <div className="fsf-top">
        <section className="fsf-card">
          <h2>{isRoadshow ? "RoadShow Detail" : "Signage Detail"}</h2>
          <div className="fsf-grid">
            <div className="fsf-field"><span className="fsf-label">JS.No</span><span className="fsf-value">{f.jsNumber || ctx.trackupNumber}</span></div>
            <div className="fsf-field"><span className="fsf-label">PIF No</span><span className="fsf-value">{ctx.pifNumber}</span></div>
            <div className="fsf-field"><span className="fsf-label">Date</span>{ro(formatDate(entryDate), "dsf-w-date")}</div>
            <div className="fsf-field"><span className="fsf-label">Client</span><span className="fsf-value">{ctx.clientName}</span></div>
            <div className="fsf-field fsf-span2"><span className="fsf-label">Campaign Period</span><span className="dsf-period">
              <b>From:</b><DateInput className="dsf-in dsf-w-date" aria-label="Campaign Start Date" value={f.campaignFrom} max={f.campaignTo || undefined} onChange={(e) => setPeriod(e.target.value, f.campaignTo)} />
              <b>To:</b><DateInput className="dsf-in dsf-w-date" aria-label="Campaign End Date" value={f.campaignTo} min={f.campaignFrom || undefined} onChange={(e) => setPeriod(f.campaignFrom, e.target.value)} />
            </span></div>
            <div className="fsf-field"><span className="fsf-label">Estimated KM Per Day</span>{num("estimatedKmPerDay")}</div>
            <div className="fsf-field"><span className="fsf-label">Reporting Date</span><input className="dsf-in dsf-ro dsf-w-date" aria-label="Reporting Date" value={formatDate(f.reportingDate)} readOnly tabIndex={-1} /></div>
            <div className="fsf-field"><span className="fsf-label">Location</span><input className="dsf-in" aria-label="Location" value={f.location} maxLength={120} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
            <div className="fsf-field"><span className="fsf-label">Fixed Milage</span>{num("fixedMileage")}</div>
            <div className="fsf-field"><span className="fsf-label">Fuel Rate</span>{num("dieselCost")}</div>
          </div>
        </section>
        <section className="fsf-card">
          <h2>Driver Detail</h2>
          <div className="fsf-grid fsf-grid-2">
            <div className="fsf-field"><span className="fsf-label">Vehicle No</span><span className="fsf-value">{ctx.vehicleNo}</span></div>
            <div className="fsf-field"><span className="fsf-label">Total Days</span><span className="fsf-value">{d(periodChanged ? days?.calendar : ctx.campaign.totalDays)}</span></div>
            <div className="fsf-field fsf-span2"><span className="fsf-label">Driver Name</span><span className="fsf-value">{ctx.driverNumber}/{ctx.driverName}</span></div>
            <div className="fsf-field"><span className="fsf-label">Suspense Amt</span><span className="fsf-with-btn">{num("suspenseAmount")}<button type="button" className="dsf-btn dsf-btn-amber" title="View advances" onClick={() => setPanel("suspense")}>v</button></span></div>
          </div>
        </section>
        <section className="fsf-card fsf-bank">
          <h2>Bank Details</h2>
          <dl>
            <div><dt>AccountName</dt><dd>{d(ctx.bank.accountName ?? ctx.driverName)}</dd></div>
            <div><dt>Account No</dt><dd>{d(ctx.bank.accountMasked)}</dd></div>
            <div><dt>Bank</dt><dd>{d(ctx.bank.bankName)}</dd></div>
            <div><dt>IFC Code</dt><dd>{d(ctx.bank.ifscCode)}</dd></div>
          </dl>
          <div className="fsf-field fsf-calc"><span className="fsf-label">ClosingBalance</span>{ro(money(t.net))}</div>
        </section>
      </div>

      <div className="fsf-pay">
        <section className="fsf-card">
          <h2>Total Per Day Salary</h2>
          <div className="fsf-grid">
            <div className="fsf-field"><span className="fsf-label">Per Day Salary</span>{num("perDaySalary", { placeholder: "Per Day Salary" })}</div>
            <div className="fsf-field"><span className="fsf-label">Per Day Food</span>{num("perDayFood", { placeholder: "Per Day Food" })}</div>
            <div className="fsf-field fsf-calc"><span className="fsf-label">Total Per Day Salary</span>{ro(money(perDayTotal))}</div>
          </div>
        </section>
        <section className="fsf-card">
          <h2>Travel</h2>
          <div className="fsf-grid fsf-grid-travel">
            <div className="fsf-field fsf-calc"><span className="fsf-label">Travel Pay(KMs)</span><input className="dsf-in num-input" readOnly aria-label="Travel Pay, open KM and rate entry" aria-haspopup="dialog" title="Click to enter Travel KM and rate per KM"
          value={travelPayPaise(f.n) ? (travelPayPaise(f.n) / 100).toFixed(2) : ""} placeholder="KM x rate" style={{ cursor: "pointer" }}
          onClick={() => setPanel("travel")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPanel("travel"); } }} />
              <small>{travelUsed ? `${f.n.travelKm || 0} km × ₹${f.n.travelRate || 0} per km` : "Click to enter KM and rate"}</small></div>
            <div className="fsf-field"><span className="fsf-label">Travel Details</span><input className="dsf-in dsf-grow" aria-label="Travel details" maxLength={300} value={f.travelDetails} onChange={(e) => setF({ ...f, travelDetails: e.target.value })} placeholder="Route / tickets" /></div>
          </div>
        </section>
      </div>

      <div className="fsf-body">
        <section className="fsf-card dsf-left">
          <h2>Mileage &amp; Days</h2>
          <div className="dsf-grid2">
            <label>Opening KM</label>{num("openingKm")}<label>Est.Budget Amt</label>{num("estimatedBudget")}
            <label>Closing KM</label>{num("closingKm")}<label>Estimated KM</label>{num("estimatedKm")}
            <label>Result</label>{ro(String(t.resultKm))}<label>Estimated Fuel</label>{num("estimatedFuel")}
            <label>IOCL card usage in Ltrs</label>{num("ioclLitres")}<span /><span />
            <label>IOCL card usage in KMs</label>{num("ioclKms")}<span /><span />
            <label>Variation in Ltrs</label>{ro(String(t.variationLitres))}<span className="dsf-hint" style={{ gridColumn: "span 2" }}>Expected {t.expectedLitres} l for {t.resultKm} km</span>
            {km && km.totalAllowedKm !== null && (
              <>
                <label>Regular KM / Day</label>{ro(String(km.kmPerDay))}<label>Extra KM / Day</label>{ro(String(km.extraKmAllotted))}
                <label>Total Allowed KM</label>{ro(String(km.totalAllowedKm))}<label>Actual KM</label>{ro(String(km.actualKm))}
                <label>Excess KM</label>{ro(String(km.excessKm))}<span /><span />
              </>
            )}
          </div>
          {km && km.totalAllowedKm !== null && (
            <p className={`dsf-hint${km.excessKm ? " text-danger" : ""}`}>
              Allowed {allowanceText(ctx.campaign.km)}; actual {kmText(km.actualKm)} (closing - opening).{" "}
              {km.excessKm ? `${kmText(km.excessKm)} over the allowance.` : "Within the allowance."} KM only: no amount is added or deducted for extra KM.
            </p>
          )}
          <div className="dsf-days">
            <label>On Road Days</label>{num("onRoadDays", { w: "dsf-w-xs" })}{ro(money(earn("On Road Days Salary")))}
            <label>On Road Sunday</label>{num("onRoadSundays", { w: "dsf-w-xs" })}{ro(money(earn("On Road Sunday Salary")))}
          </div>
          {days && <p className="dsf-hint">Campaign: {days.calendar} calendar days · {days.onRoadDays} weekdays · {days.calendar - days.onRoadDays} Sundays ({ctx.campaign.sundayHalt ? "not paid: Sunday halt" : "on road"}). Food {money(earn("Food (Per Day)"))}.</p>}
        </section>
        <section className="fsf-card fsf-claims-card">
          <h2>Expense Claims</h2>
          <div className="dsf-entry">
            <Select className="dsf-in" aria-label="Expense category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              <option value="" />{opts.finalExpenseCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Select>
            <input className="dsf-in" aria-label="Others / details" placeholder="Details" maxLength={200} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <input className="dsf-in num-input dsf-w-xs" aria-label="Quantity" placeholder="Qty" inputMode="decimal" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: sanitizeAmount(e.target.value) })} />
            <input className="dsf-in num-input" aria-label="Cost" placeholder="Cost" inputMode="decimal" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: sanitizeAmount(e.target.value) })} onKeyDown={(e) => e.key === "Enter" && addExpense()} />
            <button type="button" className="dsf-btn dsf-btn-amber dsf-add" onClick={addExpense}>Add</button>
          </div>
          {draftErr && <div className="alert">{draftErr}</div>}
          <div className="dsf-table">
            <table>
              <thead><tr><th /><th>OTHERS</th><th className="ds-amt">QTY/HRS/DAYS</th><th className="ds-amt">COST</th><th className="ds-amt">CLAIMS</th><th className="ds-amt">APPROVED</th><th /></tr></thead>
              <tbody>
                {f.expenses.length === 0 && <tr><td colSpan={7} className="dsf-empty">No expense claims added</td></tr>}
                {f.expenses.map((x, i) => {
                  const r = t.rows[i];
                  return (
                    <tr key={x.id}>
                      <td>{opts.finalExpenseCategories.find((c) => c.key === x.category)?.label ?? x.category}</td>
                      <td>{x.description || "-"}</td>
                      <td className="ds-amt">{x.quantity}</td>
                      <td className="ds-amt">{x.cost}</td>
                      <td className="ds-amt">{money(r?.claimed ?? 0)}</td>
                      <td><input className="dsf-in num-input dsf-w-s" inputMode="decimal" aria-label="Approved amount" placeholder={money(r?.claimed ?? 0)} value={x.approved}
                        onChange={(e) => setF({ ...f, expenses: f.expenses.map((y) => (y.id === x.id ? { ...y, approved: sanitizeAmount(e.target.value) } : y)) })} /></td>
                      <td><button type="button" className="dsf-x" aria-label="Remove" onClick={() => setF({ ...f, expenses: f.expenses.filter((y) => y.id !== x.id) })}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="dsf-claims">
            <label>Total Cliam Amount</label>{ro(money(t.claimed))}
            <label>Total Reject Amount</label>{ro(money(t.rejected))}
          </div>
        </section>
      </div>

      <div className="fsf-foot">
        <section className="fsf-card">
          <h2>Deductions</h2>
          <div className="fsf-grid">
            <div className="fsf-field"><span className="fsf-label">Previous Salary Deduction</span><input className="dsf-in num-input" inputMode="decimal" aria-label="Previous salary deduction" value={f.deductions.previousSalary} onChange={(e) => setD("previousSalary", sanitizeAmount(e.target.value))} />{!!f.driverChangeAmount && <small>Minimum {money(pv(f.driverChangeAmount))} (driver change)</small>}</div>
            <div className="fsf-field"><span className="fsf-label">Vehicle Damage Deduction</span><input className="dsf-in num-input" inputMode="decimal" aria-label="Vehicle damage deduction" value={f.deductions.vehicleDamage} onChange={(e) => setD("vehicleDamage", sanitizeAmount(e.target.value))} /></div>
            <div className="fsf-field"><span className="fsf-label">Mileage Short Deduction</span><span className="dsf-stack">
            <input className="dsf-in num-input" inputMode="decimal" aria-label="Mileage short deduction" value={f.deductions.mileageShort} onChange={(e) => setD("mileageShort", sanitizeAmount(e.target.value))} />
            {t.mileageShortSuggested > 0 && <button type="button" className="dsf-link" onClick={() => setD("mileageShort", (t.mileageShortSuggested / 100).toFixed(2))}>Use {money(t.mileageShortSuggested)} ({t.variationLitres} l excess)</button>}
          </span></div>
            <div className="fsf-field fsf-span2"><span className="fsf-label">Reason for deduction</span><input className="dsf-in dsf-grow" aria-label="Reason for deduction" maxLength={200} value={f.otherRemark} onChange={(e) => setF({ ...f, otherRemark: e.target.value })} /></div>
            <div className="fsf-field"><span className="fsf-label">Other deduction</span><input className="dsf-in num-input" inputMode="decimal" aria-label="Other deduction" placeholder="Other deduction" value={f.deductions.other} onChange={(e) => setD("other", sanitizeAmount(e.target.value))} /></div>
            {existing && <div className="fsf-field fsf-span-all"><span className="fsf-label">Resubmission note</span><input className="dsf-in" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What was corrected" /></div>}
          </div>
        </section>
        <section className="fsf-card fsf-summary" aria-label="Settlement summary">
          <div className="fsf-total"><span>Total Deduction Amount</span>{ro(money(t.totalDeduction))}</div>
          <div className="fsf-total fsf-net"><span>Net Amount</span>{ro(money(t.net), t.net < 0 ? "dsf-neg" : undefined)}</div>
        </section>
      </div>

      {errors.length > 0 && <div className="alert" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="dsf-actions">
        <button type="button" className="dsf-btn dsf-btn-blue" onClick={() => setPanel("closing")}>Closing Balance View</button>
        <button type="button" className="dsf-btn dsf-btn-blue" onClick={() => setPanel("onroad")}>OnRoad Report</button>
        <span className="topbar-spacer" />
        <button type="button" className="dsf-btn dsf-btn-pink" disabled={busy || !!blocked} onClick={submit}>{busy ? "Saving…" : "Save"}</button>
        <Link className="dsf-btn dsf-btn-plain" href={base} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>Close</Link>
      </div>

      {panel === "travel" && (
        <Modal title="Travel KM Payment" onClose={() => setPanel(null)}>
          <label className="field"><span>Travel KM</span><input className="num-input" inputMode="decimal" autoFocus value={f.n.travelKm} onChange={(e) => setTravel("travelKm", sanitizeAmount(e.target.value))} /></label>
          <label className="field"><span>Rate per KM (₹)</span><input className="num-input" inputMode="decimal" value={f.n.travelRate} onChange={(e) => setTravel("travelRate", sanitizeAmount(e.target.value))} /></label>
          <p><strong>Travel Pay: {money(travelPayPaise(f.n))}</strong></p>
          {!travelUsed && !!pv(f.n.travelPay) && <p className="muted">Entering KM and rate replaces the saved amount.</p>}
          {travelUsed && !(pv(f.n.travelKm) && pv(f.n.travelRate)) && <p className="field-error" role="alert">Enter both the Travel KM and the rate per KM</p>}
          <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => setPanel(null)}>Done</button></div>
        </Modal>
      )}
      {panel === "suspense" && (
        <Modal title="Suspense Amount (advances paid)" onClose={() => setPanel(null)}>
          <table className="table ds-mini"><thead><tr><th>Source</th><th>Date</th><th>Details</th><th className="ds-amt">Amount</th></tr></thead>
            <tbody>
              {(ctx.advances ?? []).map((a, i) => <tr key={`a${i}`}><td>{a.source}</td><td>{formatDateTime(a.date)}</td><td>{a.note}</td><td className="ds-amt">{formatInr(a.amount)}</td></tr>)}
              {(ctx.dailyPayments ?? []).filter((p) => p.salaryAdvance > 0 && (p.status === "APPROVED" || p.status === "COMPLETED")).map((p) => <tr key={p.paymentNumber}><td>Daily payment salary advance</td><td>{formatDate(p.fromDate)}</td><td>{p.paymentNumber}</td><td className="ds-amt">{formatInr(p.salaryAdvance)}</td></tr>)}
            </tbody>
          </table>
          <p className="muted ds-note">Prefilled suspense: {formatInr(Number(ctx.prefill.suspenseAmount) || 0)}. Entered: {money(pv(f.n.suspenseAmount))}.</p>
        </Modal>
      )}
      {panel === "closing" && (
        <Modal title="Closing Balance" onClose={() => setPanel(null)}>
          <dl className="ds-kv">
            {t.earnings.filter((e) => e.amount).map((e) => <Row key={e.label} k={e.label} v={money(e.amount)} />)}
            <Row k="Approved expense claims" v={money(t.approved)} /><Row k="Gross" v={<b>{money(t.gross)}</b>} />
            <Row k="Total Deduction" v={money(t.totalDeduction)} /><Row k="Suspense Amount" v={money(pv(f.n.suspenseAmount))} /><Row k="Net Amount (closing balance)" v={<b>{money(t.net)}</b>} />
          </dl>
        </Modal>
      )}
      {panel === "onroad" && (
        <Modal title="OnRoad Report: daily payments" onClose={() => setPanel(null)} wide>
          {(ctx.dailyPayments ?? []).length === 0 ? <p className="muted">No daily payments recorded for this driver on this vehicle.</p> : (
            <table className="table ds-mini"><thead><tr><th>Payment No</th><th>Period</th><th>Status</th><th className="ds-amt">Diesel</th><th className="ds-amt">Food</th><th className="ds-amt">Salary Adv.</th><th className="ds-amt">Total Payable</th></tr></thead>
              <tbody>{ctx.dailyPayments!.map((p) => <tr key={p.paymentNumber}><td>{p.paymentNumber}</td><td>{formatDate(p.fromDate)} – {formatDate(p.toDate)}</td><td>{p.status}</td><td className="ds-amt">{formatInr(p.diesel)}</td><td className="ds-amt">{formatInr(p.food)}</td><td className="ds-amt">{formatInr(p.salaryAdvance)}</td><td className="ds-amt">{formatInr(p.amount)}</td></tr>)}</tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}