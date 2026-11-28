"use client";

import ReadMore from "@/components/ui/ReadMore";
import VerticalSelect from "@/components/ui/VerticalSelect";
import { verticalLabel } from "@/utils/vertical";
import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { RsaPager } from "@/components/RsaHistory";
import { EmptyState, ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { useSessionState } from "@/hooks/useSessionState";
import { downloadFile, request } from "@/services/api";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";
import { kmText } from "@/utils/kmAllowance";
import {
  ACTION_LABEL, CATEGORY_SHORT, STATUS_LABEL, actionsFor, isHighlightedExpense, modeLabel, recalcMileage, paymentsBase, emptyQueueFilters, queueQuery, type PaymentCategory, type QueueFilters, type SettlementDetail, type SettlementPage,
  type SettlementRow, type SettlementStatus, type SuspenseRecords,
} from "@/utils/settlement";
import { PaymentEntryForm, PaymentEntryModal } from "@/components/settlement/PaymentEntry";
import BulkApproveModal from "@/components/settlement/BulkApproveModal";
import SuspenseTable from "@/components/settlement/SuspenseTable";
import { canBulkApprove } from "@/utils/bulkApproval";

const d = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v));

export const SettlementBadge = ({ status }: { status: SettlementStatus }) => <span className={`ds-badge ds-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
/** Shown in place of Entry once the payment is recorded (from the saved COMPLETED status, so it survives refresh). */
export function EntryCompletedBadge({ p }: { p: SettlementRow }) {
  const c = p.completion;
  const tip = c ? `Ref ${c.referenceNumber} · ${modeLabel(c.paymentMode)}${c.bankName ? ` · ${c.bankName}` : ""} · paid ${formatDate(c.paymentDate)}` : "Payment recorded";
  return (
    <span className="ds-entry-done" aria-label={`Entry completed. ${tip}`} tabIndex={0}>
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".16" /><path d="m7.5 12.2 3 3 6-6.4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Entry Completed
      {c && <span className="ds-entry-tip" role="tooltip">{tip}</span>}
    </span>
  );
}
export const CategoryTag =({ c }: { c: PaymentCategory }) => <span className={`ds-tag ds-tag-${c.toLowerCase()}`}>{CATEGORY_SHORT[c]}</span>;

/** Status filter choices per screen. The completed table is a separate screen. */
const STATUS_OPTIONS: Record<string, { v: string; l: string }[]> = {
  queue: [{ v: "", l: "All" }, { v: "PENDING", l: "Pending" }, { v: "APPROVED", l: "Approved" }],
  rbp: [{ v: "", l: "All" }, { v: "PENDING", l: "Pending" }, { v: "APPROVED", l: "Approved" }, { v: "REJECTED", l: "Rejected" }, { v: "COMPLETED", l: "Paid" }],
};

/** Status summary cards; a card whose status this list can show filters the table (click again to clear). */
export function SummaryCards({ s, category, status, pickable = [], onPick }: { s: SettlementPage["summary"]; category: "" | PaymentCategory; status?: string; pickable?: string[]; onPick?: (status: string) => void }) {
  const pick = (st: string) => (["DAILY", "FINAL"] as const).filter((c) => !category || c === category).reduce((a, c) => {
    const x = s[`${c}:${st}`];
    return { count: a.count + (x?.count ?? 0), amount: a.amount + (x?.amount ?? 0) };
  }, { count: 0, amount: 0 });
  const cards = [["Pending Approval", "PENDING", "ds-k-pending"], ["Approved, awaiting payment", "APPROVED", "ds-k-approved"], ["Paid", "COMPLETED", "ds-k-paid"], ["Rejected", "REJECTED", "ds-k-rejected"]] as const;
  return (
    <div className="ds-kpis">
      {cards.map(([label, st, cls]) => {
        const v = pick(st);
        const body = (
          <>
            <span>{label}</span>
            <strong>{v.count}</strong>
            <small>{formatInr(Math.round(v.amount * 100) / 100)}</small>
          </>
        );
        return onPick && pickable.includes(st) ? (
          <button key={st} type="button" className={`ds-kpi ${cls} stat-click${status === st ? " is-active" : ""}`} aria-pressed={status === st} onClick={() => onPick(status === st ? "" : st)} title={`Show ${label.toLowerCase()}`}>{body}</button>
        ) : (
          <div key={st} className={`ds-kpi ${cls}`}>{body}</div>
        );
      })}
    </div>
  );
}

const COLS: { key: string; label: string; sort?: string }[] = [
  { key: "no", label: "Payment No", sort: "paymentNumber" }, { key: "cat", label: "Category" }, { key: "proj", label: "Project" }, { key: "veh", label: "Vehicle", sort: "vehicleNo" },
  { key: "drv", label: "Driver", sort: "driverName" }, { key: "dates", label: "Period", sort: "fromDate" }, { key: "amt", label: "Amount", sort: "amount" },
  { key: "by", label: "Submitted", sort: "submittedAt" }, { key: "st", label: "Status", sort: "status" }, { key: "act", label: "" },
];

/**
 * Common payment approval table (all roles). `mode`:
 *  queue      - pending + approved (RSOM / RSO / RSA)       rbp - every status, RBP's own view
 *  completed  - the Payment Completed table (RSA)
 */
export function PaymentQueue({ mode, defaultCategory = "", toolbar, reloadKey = 0, onFilters }: { mode: "queue" | "rbp" | "completed"; defaultCategory?: "" | PaymentCategory; toolbar?: ReactNode; reloadKey?: number; onFilters?: (applied: QueueFilters) => void }) {
  // filters, page and page size survive Back / sidebar navigation within the tab
  const [f, setF] = useSessionState<QueueFilters>(`queue:${mode}:${defaultCategory}`, emptyQueueFilters(defaultCategory, mode === "completed" ? "COMPLETED" : ""));
  const [paging, setPaging] = useSessionState(`queue:${mode}:${defaultCategory}:paging`, { page: 1, limit: 10 });
  const { page, limit } = paging;
  const setPage = (n: number) => setPaging((x) => ({ ...x, page: n }));
  const setLimit = (n: number) => setPaging((x) => ({ ...x, limit: n }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [entryRow, setEntryRow] = useState<SettlementRow | null>(null);
  const [tick, setTick] = useState(0);
  const { user } = useAuth();
  // RSA records the actual payment of an approved entry from Driver Payments (Entry), which moves it to Payment Completed
  const canEnter = (p: SettlementRow) => mode === "rbp" && user?.role === "RSA" && p.status === "APPROVED";
  const dq = useDebounce(f.q);
  const list = useApi<SettlementPage>(`/settlements?${queueQuery({ ...f, q: dq }, page, limit)}${mode === "rbp" ? "&scope=all" : ""}&_=${reloadKey}-${tick}`);
  // Bulk Approve (RSOM): only pending daily rows on screen can be selected; changing filters, sort or page clears the selection.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<SettlementRow[] | null>(null);
  const eligible = mode === "queue" ? (list.data?.items ?? []).filter((p) => canBulkApprove(user?.role, p)) : [];
  const selected = eligible.filter((p) => picked.has(p._id));
  const allPicked = eligible.length > 0 && selected.length === eligible.length;
  const bulk = mode === "queue" && user?.role === "RSOM";
  const clearPicked = () => setPicked(new Set());
  const toggle = (id: string) => setPicked((s) => { const next = new Set(s); if (!next.delete(id)) next.add(id); return next; });
  // report the filters the table is showing (the search once its debounce has settled)
  useEffect(() => { onFilters?.({ ...f, q: dq }); }, [f, dq, onFilters]);
  const change = (next: QueueFilters) => {
    setF(next);
    setPage(1);
    clearPicked();
  };
  const sortBy = (key?: string) => key && change({ ...f, sort: key, dir: f.sort === key && f.dir === "desc" ? "asc" : "desc" });
  const active = !!(f.projectType || f.q || f.from || f.to || (mode !== "completed" && f.status) || f.category !== defaultCategory);

  return (
    <>
      {list.data && mode !== "completed" && (
        <SummaryCards s={list.data.summary} category={f.category} status={f.status} pickable={STATUS_OPTIONS[mode].map((o) => o.v).filter(Boolean)} onPick={(st) => change({ ...f, status: st })} />
      )}
      <div className="card ds-card">
        <div className="ds-toolbar">
          {/* RSOM has daily payments only (the server limits the list too), so there is nothing to switch */}
          {user?.role !== "RSOM" && (
            <div className="ds-seg" role="tablist" aria-label="Category">
              {(["", "DAILY", "FINAL"] as const).map((c) => (
                <button key={c || "all"} type="button" role="tab" aria-selected={f.category === c} className={f.category === c ? "on" : ""} onClick={() => change({ ...f, category: c })}>
                  {c ? `${CATEGORY_SHORT[c]}` : "All"}
                </button>
              ))}
            </div>
          )}
          {mode !== "completed" && (
            <Select aria-label="Status" value={f.status} onChange={(e) => change({ ...f, status: e.target.value })}>
              {STATUS_OPTIONS[mode].map((o) => <option key={o.v} value={o.v}>{o.l === "All" ? "All status" : o.l}</option>)}
            </Select>
          )}
          <VerticalSelect value={f.projectType ?? ""} onChange={(v) => change({ ...f, projectType: v })} />
          <input className="ds-search" placeholder="Search payment no, trackup, client, vehicle, driver, reference" value={f.q} onChange={(e) => change({ ...f, q: e.target.value })} aria-label="Search" />
          <label className="ds-range">From<DateInput value={f.from} onChange={(e) => change({ ...f, from: e.target.value })} /></label>
          <label className="ds-range">To<DateInput value={f.to} min={f.from || undefined} onChange={(e) => change({ ...f, to: e.target.value })} /></label>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!active} onClick={() => change(emptyQueueFilters(defaultCategory, mode === "completed" ? "COMPLETED" : ""))}>Clear</button>
          {toolbar && <span className="ds-toolbar-end">{toolbar}</span>}
        </div>
        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data?.items.length ? (
          <EmptyState title={active ? "No payments match your filters" : mode === "completed" ? "No completed payments yet" : "No payments yet"} hint={active ? "Try a different search or clear the filters." : undefined} />
        ) : (
          <>
            {selected.length > 0 && (
              <div className="inline ds-gap">
                <span>{selected.length} payment{selected.length > 1 ? "s" : ""} selected</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setApproving(selected)}>Bulk Approve</button>
              </div>
            )}
            <TableWrap className={list.refreshing ? " is-refreshing" : ""} aria-busy={list.refreshing}>
              <table className="table ds-table">
                <thead>
                  <tr>
                    {bulk && (
                      <th>
                        <input type="checkbox" aria-label="Select all pending payments" disabled={!eligible.length} checked={allPicked}
                          ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allPicked; }}
                          onChange={() => setPicked(new Set(allPicked ? [] : eligible.map((p) => p._id)))} />
                      </th>
                    )}
                    {/* completed: the payment details replace Period / Submitted (both stay in View) so they fit without scrolling */}
                    {(mode === "completed" ? [COLS[0], COLS[2], { key: "drv", label: "Driver / Vehicle", sort: "driverName" }, COLS[6], { key: "ref", label: "Reference No." }, { key: "paid", label: "Paid On · Mode of Payment" }, COLS[9]] : COLS).flatMap((c, i) => (i === 1 ? [{ key: "vert", label: "Vertical" }, c] : [c])).map((c) => (
                      <th key={c.key} aria-sort={"sort" in c && c.sort && f.sort === c.sort ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
                        {"sort" in c && c.sort ? (
                          <button type="button" className="ds-sort" onClick={() => sortBy(c.sort)}>
                            {c.label}
                            <span aria-hidden>{f.sort === c.sort ? (f.dir === "asc" ? " ▲" : " ▼") : ""}</span>
                          </button>
                        ) : c.label ? c.label : <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p._id}>
                      {bulk && <td>{canBulkApprove(user?.role, p) && <input type="checkbox" aria-label={`Select ${p.paymentNumber}`} checked={picked.has(p._id)} onChange={() => toggle(p._id)} />}</td>}
                      <td><strong className="num">{p.paymentNumber}</strong>{p.version > 1 && <small className="muted"> v{p.version}</small>}{p.previousData && <div><span className="badge badge-created">Previous Data</span></div>}{mode === "completed" && <div className="ds-cat-under"><CategoryTag c={p.category} /></div>}</td>
                      <td>{verticalLabel(p.projectType)}</td>
                      {mode !== "completed" && <td><CategoryTag c={p.category} /></td>}
                      <td><div>{d(p.clientName)}</div><small className="muted">{[p.trackupNumber, p.pifNumber].filter(Boolean).join(" · ")}</small></td>
                      {mode === "completed" ? (
                        <td><div>{d(p.driverName)}</div><small className="muted">{d(p.driverNumber)} · {d(p.vehicleNo)}</small></td>
                      ) : (
                        <>
                          <td>{d(p.vehicleNo)}</td>
                          <td><div>{d(p.driverName)}</div><small className="muted">{d(p.driverNumber)}</small></td>
                        </>
                      )}
                      {mode !== "completed" && <td className="ds-nowrap">{formatDate(p.fromDate)}<br /><small className="muted">to {formatDate(p.toDate)}</small></td>}
                      <td className="ds-amt">{formatInr(p.amount)}</td>
                      {mode !== "completed" && <td><div>{p.submittedBy}{p.submittedRole && p.submittedRole !== p.submittedBy && <small className="muted"> · {p.submittedRole}</small>}</div><small className="muted">{formatDateTime(p.submittedAt)}</small></td>}
                      {mode === "completed" ? (
                        <>
                          <td><strong className="num">{p.completion?.referenceNumber}</strong>{p.completion?.referenceDate && <><br /><small className="muted">Ref. {formatDate(p.completion.referenceDate)}</small></>}</td>
                          <td className="ds-paid"><div className="ds-nowrap">{formatDate(p.completion?.paymentDate)}</div><small className="muted"><b>{modeLabel(p.completion?.paymentMode)}</b> · {p.completion?.bankName ?? "no bank (cash)"}</small></td>
                        </>
                      ) : (
                        <td><SettlementBadge status={p.status} /></td>
                      )}
                      <td>
                        <span className="ds-row-actions">
                          {canEnter(p) && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEntryRow(p)} aria-label={`Payment entry for ${p.paymentNumber}`}>Entry</button>}
                          {mode === "rbp" && p.status === "COMPLETED" && <EntryCompletedBadge p={p} />}
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpenId(p._id)}>View</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <RsaPager total={list.data.total} page={page} limit={limit} onPage={(n) => { setPage(n); clearPicked(); }} onLimit={(n) => { setLimit(n); setPage(1); clearPicked(); }} />
          </>
        )}
      </div>
      {openId && <PaymentDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={() => setTick((t) => t + 1)} />}
      {approving && <BulkApproveModal rows={approving} onClose={(attempted) => { setApproving(null); if (attempted) { clearPicked(); setTick((t) => t + 1); } }} />}
      {entryRow && <PaymentEntryModal p={entryRow} onClose={() => setEntryRow(null)} onSaved={() => { setEntryRow(null); setTick((t) => t + 1); }} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ detail + actions

function KV({ items }: { items: [string, ReactNode][] }) {
  return <dl className="ds-kv">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === null || v === undefined || v === "" ? "-" : v}</dd></div>)}</dl>;
}

export function PaymentDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const r = useApi<SettlementDetail>(`/settlements/${id}?_=${tick}`);
  const [mode, setMode] = useState<null | "approve" | "reject" | "complete">(null);
  const [busy, setBusy] = useState(false);
  const p = r.data;
  // RSO may correct the mileage while the settlement is pending; the breakdown previews every dependent figure as it is typed
  const [mileage, setMileage] = useState<string | null>(null);
  const typed = Number(mileage);
  const preview = p && mileage !== null && typed > 0 ? recalcMileage(p.data, typed) : null;
  const canEditMileage = !!p && p.category === "FINAL" && p.status === "PENDING" && user?.role === "RSO";
  const saveMileage = async () => {
    if (!p) return;
    setBusy(true);
    try {
      await request(`/settlements/${id}/mileage`, "POST", { fixedMileage: mileage!.trim(), version: p.version });
      toast("Mileage updated");
      setMileage(null);
      done();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const detailExcel = async () => {
    setBusy(true);
    try {
      await downloadFile(`/settlements/${id}/detail-export`, "settlement.xlsx");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const [showSuspense, setShowSuspense] = useState(false);
  const suspenseOpen = showSuspense && p?.category === "FINAL";
  const suspense = useApi<SuspenseRecords & { saved: number }>(suspenseOpen ? `/settlements/${id}/suspense` : null);
  const suspensePdf = () => downloadFile(`/settlements/${id}/suspense-pdf`, "payment-details.pdf").catch((e: Error) => toast(e.message, "error"));
  const can = p && user ? actionsFor(user.role, p) : null;
  const done = () => {
    setMode(null);
    setTick((t) => t + 1);
    onChanged();
  };
  const pdf = async () => {
    setBusy(true);
    try {
      await downloadFile(`/settlements/${id}/salary-pdf`, "driver-salary.pdf");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={p ? `${p.paymentNumber} · ${p.categoryLabel}` : "Payment"} onClose={onClose} wide>
      {r.loading ? <Skeleton rows={6} /> : r.error ? <ErrorState message={r.error} onRetry={r.reload} /> : p && (
        <div className="ds-detail">
          <div className="ds-detail-head">
            <SettlementBadge status={p.status} />
            <CategoryTag c={p.category} />
            <span className="muted">Version {p.version} · approval by {p.approver}</span>
            <span className="ds-detail-amt">{formatInr(preview ? preview.netAmount : p.amount)}</span>
            {p.category === "FINAL" && (user?.role === "RSO" || user?.role === "RSA") && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={detailExcel}>Export Excel</button>}
            {p.category === "FINAL" && (user?.role === "RSO" || user?.role === "RSA") && <button type="button" className="btn btn-outline btn-sm" aria-expanded={showSuspense} onClick={() => setShowSuspense((v) => !v)}>Suspense Records</button>}
          </div>
          {suspenseOpen && (
            <section className="ds-sec">
              <h4>Suspense records (daily payments)</h4>
              {suspense.loading ? <Skeleton rows={3} /> : suspense.error || !suspense.data ? <ErrorState message={suspense.error ?? "Could not load"} onRetry={suspense.reload} /> : (
                <>
                  <SuspenseTable records={suspense.data} />
                  <p className="muted">Suspense Amount saved on this settlement: {formatInr(suspense.data.saved)}</p>
                  <button type="button" className="btn btn-outline btn-sm" onClick={suspensePdf}>Download PDF</button>
                </>
              )}
            </section>
          )}
          {p.status === "REJECTED" && p.rejectionReason && <div className="alert"><ReadMore>Rejected by {p.reviewedBy}: {p.rejectionReason}</ReadMore></div>}

          <section className="ds-sec">
            <h4>Project, vehicle &amp; driver</h4>
            <KV items={[
              ["Trackup No", p.trackupNumber], ["PIF No", p.pifNumber], ["JS No", p.jsNumber], ["Client", p.clientName], ["Project Type", p.projectType === "ROADSHOW" ? "RoadShow" : "Signage"],
              ["Vehicle No", p.vehicleNo], ["Driver", `${d(p.driverName)} (${d(p.driverNumber)})`], ["Period", `${formatDate(p.fromDate)} to ${formatDate(p.toDate)}`],
              ["Bank", p.bank ? `${d(p.bank.bankName)} · ${d(p.bank.accountMasked)} · ${d(p.bank.ifscCode)}` : "-"],
            ]} />
          </section>
          {p.category === "DAILY" ? <DailyBreakdown data={p.data} /> : (
            <FinalBreakdown data={preview ?? p.data} mileage={!canEditMileage ? null : mileage === null ? (
              <button type="button" className="ds-pencil" aria-label="Edit mileage" title="Edit mileage" onClick={() => setMileage(String(p.data.fuel.fixedMileage))}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
              </button>
            ) : (
              <span className="ds-mileage-edit">
                <input inputMode="decimal" aria-label="Fixed Mileage" autoFocus value={mileage} onChange={(e) => setMileage(e.target.value.replace(/[^0-9.]/g, ""))} />
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !preview || preview.netAmount < 0 || typed === p.data.fuel.fixedMileage} onClick={saveMileage}>Save</button>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setMileage(null)}>Cancel</button>
                {preview && preview.netAmount < 0 && <small className="field-error">Net Amount would be negative</small>}
              </span>
            )} />
          )}

          {p.status === "APPROVED" && !p.completion && (
            <section className="ds-sec">
              <h4>Payment Detail</h4>
              <KV items={[["Reference No.", "Awaiting payment. RSA records it with Entry in Driver Payments."]]} />
            </section>
          )}
          {p.completion && (
            <section className="ds-sec">
              <h4>Payment Detail (paid)</h4>
              <KV items={[
                ["Reference No.", p.completion.referenceNumber], ["Reference Date", p.completion.referenceDate ? formatDate(p.completion.referenceDate) : "-"],
                ["Payment Mode", modeLabel(p.completion.paymentMode)], ["Payment Date", formatDate(p.completion.paymentDate)], ["Mode of Payment", d(p.completion.bankName)],
                ...(p.completion.transactionMasked ? [["Transaction", p.completion.transactionMasked] as [string, string]] : []),
                ...(p.completion.remarks ? [["Remarks", <ReadMore key="r">{p.completion.remarks}</ReadMore>] as [string, ReactNode]] : []),
                ["Recorded by", `${p.completion.completedBy} · ${formatDateTime(p.completion.completedAt)}`],
              ]} />
            </section>
          )}

          <section className="ds-sec">
            <h4>Approval history</h4>
            <ol className="ds-timeline">
              {p.history.map((h, i) => (
                <li key={i} className={`ds-tl-${h.action.toLowerCase()}`}>
                  <strong>{ACTION_LABEL[h.action] ?? h.action}</strong> <span className="muted">v{h.version} · {h.username} ({h.role}) · {formatDateTime(h.createdAt)}</span>
                  {h.amount !== null && (h.action === "SUBMITTED" || h.action === "RESUBMITTED") && <span className="muted"> · {formatInr(h.amount)}</span>}
                  {h.comment && <div className="ds-tl-note"><ReadMore>{h.comment}</ReadMore></div>}
                </li>
              ))}
            </ol>
          </section>

          {can && (can.canDecide || can.canResubmit || can.canComplete || can.canPdf) && !mode && mileage === null && (
            <div className="actions-row ds-actions">
              {can.canPdf && <button type="button" className="btn btn-outline" disabled={busy} onClick={pdf}>Download Salary PDF</button>}
              {can.canResubmit && <Link className="btn btn-primary" href={`${paymentsBase(user?.role)}/${p.category === "DAILY" ? "daily" : "final"}?id=${p._id}&tv=${p.trackingVehicle}`}>Correct &amp; Resubmit</Link>}
              {can.canDecide && <button type="button" className="btn btn-danger" onClick={() => setMode("reject")}>Reject</button>}
              {can.canDecide && <button type="button" className="btn btn-primary" onClick={() => setMode("approve")}>Approve</button>}
              {can.canComplete && <button type="button" className="btn btn-primary" onClick={() => setMode("complete")}>Payment Entry</button>}
            </div>
          )}
          {(mode === "approve" || mode === "reject") && <DecisionForm p={p} decision={mode} onCancel={() => setMode(null)} onDone={done} />}
          {mode === "complete" && <PaymentEntryForm inline p={p} onCancel={() => setMode(null)} onDone={done} />}
        </div>
      )}
    </Modal>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DailyBreakdown({ data }: { data: Record<string, any> }) {
  return (
    <section className="ds-sec">
      <h4>Daily payment</h4>
      <KV items={[
        ["Payment For", data.paymentFor === "SIGNAGE" ? "Signage" : "RoadShow"], ["Cash in Hand", data.cashInHand ? "Yes" : "No"], ["Fuel Cost", formatInr(data.dieselTotal)],
        ["Food", formatInr(data.foodAmount)], ["Salary Advance", formatInr(data.salaryAdvance)],
      ]} />
      {!!data.expenses?.length && (
        <table className="table ds-mini">
          <thead><tr><th>Detail</th><th>Description</th><th>Deduct</th><th className="ds-amt">Amount</th></tr></thead>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <tbody>{data.expenses.map((e: any, i: number) => <tr key={i}><td>{e.optionLabel}</td><td>{d(e.description)}</td><td>{e.deduct ? "Yes" : "No"}</td><td className="ds-amt">{e.deduct ? "−" : ""}{formatInr(e.amount)}</td></tr>)}</tbody>
        </table>
      )}
      <div className="ds-totals"><span>Total <b>{formatInr(data.total)}</b></span><span>Deductions <b>{formatInr(data.deductTotal)}</b></span><span className="ds-grand">Total Payable <b>{formatInr(data.totalPayable)}</b></span></div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FinalBreakdown({ data, mileage }: { data: Record<string, any>; mileage?: ReactNode }) {
  return (
    <>
      <section className="ds-sec">
        <h4>Campaign &amp; fuel</h4>
        <KV items={[
          ["Campaign", `${formatDate(data.campaignFrom)} to ${formatDate(data.campaignTo)}`], ["Total Days", data.totalDays], ["Location", data.location], ["Reporting Date", formatDate(data.reportingDate)],
          ["Fixed Mileage", <span key="m" className="ds-mileage">{data.fuel.fixedMileage} km/l {mileage}</span>], ["Opening / Closing KM", `${data.fuel.openingKm} / ${data.fuel.closingKm}`], ["Result", `${data.fuel.resultKm} km`],
          ...(data.rates?.travelKm ? [["Travel KM x Rate", `${data.rates.travelKm} km x ${formatInr(data.rates.travelRate)} = ${formatInr(data.rates.travelPay)}`] as [string, string]] : []),
          ["Fuel Cost", `${formatInr(data.fuel.dieselCost)} / l`], ["IOCL (litres / KMs)", `${data.fuel.ioclLitres} / ${data.fuel.ioclKms}`], ["Variation in Litres", data.fuel.variationLitres],
          ["Estimated Budget", formatInr(data.estimate.estimatedBudget)], ["Estimated KM / Fuel", `${data.estimate.estimatedKm} km / ${data.estimate.estimatedFuel} l`],
          // KM allowance saved with the settlement (RoadShow; absent on settlements saved before it was recorded)
          ...(data.km && data.km.totalAllowedKm !== null && data.km.totalAllowedKm !== undefined ? [
            ["Regular KM / Day", kmText(data.km.kmPerDay)], ["Extra KM / Day", kmText(data.km.extraKmAllotted)],
            ["Total Allowed KM", `${kmText(data.km.totalAllowedKm)}${data.km.campaignDays ? ` (${kmText(data.km.allowedKmPerDay ?? (data.km.kmPerDay ?? 0) + (data.km.extraKmAllotted ?? 0))}/day x ${data.km.campaignDays} days)` : ""}`],
            ["Actual KM", kmText(data.km.actualKm)], ["Excess KM", kmText(data.km.excessKm)],
          ] as [string, string][] : []),
        ]} />
      </section>
      <section className="ds-sec">
        <h4>Earnings &amp; expenses</h4>
        <table className="table ds-mini">
          <thead><tr><th>Description</th><th>Others</th><th className="ds-amt">Cost</th><th className="ds-amt">Qty / Days / Hrs</th><th className="ds-amt">Claimed</th><th className="ds-amt">Approved</th></tr></thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {data.earnings.filter((e: any) => e.amount > 0).map((e: any) => <tr key={e.key} className={isHighlightedExpense(e) ? "ds-hl" : undefined}><td>{e.label}</td><td /><td className="ds-amt">{formatInr(e.rate)}</td><td className="ds-amt">{e.quantity}</td><td className="ds-amt">{formatInr(e.amount)}</td><td className="ds-amt">{formatInr(e.amount)}</td></tr>)}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {data.expenses.map((e: any, i: number) => <tr key={i} className={isHighlightedExpense(e) ? "ds-hl" : undefined}><td>{e.label}</td><td>{d(e.description)}</td><td className="ds-amt">{formatInr(e.cost)}</td><td className="ds-amt">{e.quantity}</td><td className="ds-amt">{formatInr(e.claimed)}</td><td className="ds-amt">{formatInr(e.approved)}{e.rejected > 0 && <small className="text-danger"> (−{formatInr(e.rejected)})</small>}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="ds-sec">
        <h4>Deductions &amp; net</h4>
        <KV items={[
          ["Mileage Short", formatInr(data.deductions.mileageShort)], ...(data.deductions.driverChangeTravel !== undefined ? [["Driver Change Travel", formatInr(data.deductions.driverChangeTravel)] as [string, string]] : []), ["Vehicle Damage", formatInr(data.deductions.vehicleDamage)],
          ["Previous Salary", formatInr(data.deductions.previousSalary)], ["Other", `${formatInr(data.deductions.other)}${data.otherDeductionRemark ? ` (${data.otherDeductionRemark})` : ""}`],
        ]} />
        <div className="ds-totals"><span>Gross <b>{formatInr(data.gross)}</b></span><span>Suspense <b>{formatInr(data.suspenseAmount)}</b></span><span>{data.totalDeductionIncludesSuspense ? "Total Deduction (incl. Suspense)" : "Total Deduction"} <b>{formatInr(data.totalDeduction)}</b></span><span className="ds-grand">Net Amount <b>{formatInr(data.netAmount)}</b></span></div>
      </section>
    </>
  );
}

function DecisionForm({ p, decision, onCancel, onDone }: { p: SettlementDetail; decision: "approve" | "reject"; onCancel: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (decision === "reject" && text.trim().length < 3) return setErr("Enter the reason for rejection");
    setBusy(true);
    setErr("");
    try {
      await request(`/settlements/${p._id}/${decision}`, "POST", decision === "reject" ? { reason: text.trim(), version: p.version } : { comment: text.trim() || undefined, version: p.version });
      toast(`${p.paymentNumber} ${decision === "approve" ? "approved" : "rejected"}`);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="ds-inline-form">
      <label className="field">
        {decision === "reject" ? "Reason for rejection *" : "Comment (optional)"}
        <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      {err && <div className="alert" role="alert">{err}</div>}
      <div className="actions-row">
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={`btn ${decision === "reject" ? "btn-danger" : "btn-primary"}`} onClick={submit} disabled={busy}>
          {busy ? "Please wait…" : decision === "reject" ? "Confirm Reject" : `Approve ${formatInr(p.amount)}`}
        </button>
      </div>
    </div>
  );
}
