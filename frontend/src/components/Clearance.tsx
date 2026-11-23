"use client";

import Link from "next/link";
import { useState } from "react";
import { RsaPager } from "@/components/RsaHistory";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import {
  ACTION_LABEL, STATUS_LABEL, clearanceFiltersActive, clearanceQuery, emptyClearanceFilters, financialLabel, outstandingText,
  type ClearanceDetail, type DeliverySummary, type ClearanceFilters, type ClearanceFinancial, type ClearanceHistoryRow, type ClearanceRow, type ClearanceStatus, type ClearanceSummary,
} from "@/utils/clearance";
import { DELIVERY_LABEL, RBP_STATUS_OPTIONS, RSA_LABEL, canShowDeliver } from "@/utils/delivery";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";

const dash = (v: React.ReactNode) => (v === null || v === undefined || v === "" ? "—" : v);
const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (<div><dt>{k}</dt><dd>{dash(v)}</dd></div>);
const TYPE_LABEL: Record<string, string> = { ROADSHOW: "Roadshow", SIGNAGE: "Signage" };
const DRIVER_TYPE: Record<string, string> = { COMPANY_DRIVER: "Company Driver", ACTING_DRIVER: "Acting Driver" };

export const ClearanceStatusBadge = ({ status }: { status: ClearanceStatus }) => (
  <span className={`badge badge-cl-${status.toLowerCase()}`}>{status === "YET_TO_APPROVE" ? "Waiting for RSA Approval" : STATUS_LABEL[status]}</span>
);

export function ClearanceSummaryCards({ s, labels }: { s: ClearanceSummary; labels: [string, string, string, string] }) {
  const cards: [string, number][] = [[labels[0], s.total], [labels[1], s.yetToApprove], [labels[2], s.approved], [labels[3], s.rejected]];
  return (
    <div className="stat-row" data-section="summary-cards">
      {cards.map(([label, n]) => (<div key={label} className="stat"><span>{label}</span><strong>{n}</strong></div>))}
    </div>
  );
}

export function DeliverySummaryCards({ s }: { s: DeliverySummary }) {
  const cards: [string, number][] = [["Total Allocations", s.total], ["Approved by RSA", s.approved], ["Yet to Approve", s.yetToApprove], ["Rejected by RSA", s.rejected], ["Yet to Deliver", s.yetToDeliver], ["Delivered", s.delivered]];
  return (
    <div className="stat-row" data-section="summary-cards">
      {cards.map(([label, n]) => (<div key={label} className="stat"><span>{label}</span><strong>{n}</strong></div>))}
    </div>
  );
}

export function ClearanceFiltersBar({ f, onChange, onClear, searchHint, mode = "RSA" }: { f: ClearanceFilters; onChange: (n: ClearanceFilters) => void; onClear: () => void; searchHint: string; mode?: "RSA" | "RBP" }) {
  const set = <K extends keyof ClearanceFilters>(k: K, v: ClearanceFilters[K]) => onChange({ ...f, [k]: v });
  return (
    <div className="filters-vehicle rsa-filters" data-section="clearance-filters">
      <input className="search-wide" aria-label="Mass search" value={f.q} onChange={(e) => set("q", e.target.value)} placeholder={searchHint} />
      <select value={f.status} aria-label="Status filter" onChange={(e) => set("status", e.target.value)}>
        {mode === "RBP"
          ? RBP_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          : <><option value="">All</option><option value="YET_TO_APPROVE">Yet to Approve</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></>}
      </select>
      <select value={f.projectType} aria-label="Project type filter" onChange={(e) => set("projectType", e.target.value)}>
        <option value="">Roadshow / Signage</option><option value="ROADSHOW">Roadshow</option><option value="SIGNAGE">Signage</option>
      </select>
      <label className="rsa-range">Allocation date from<input type="date" value={f.from} aria-label="Allocation date from" onChange={(e) => set("from", e.target.value)} /></label>
      <label className="rsa-range">to<input type="date" value={f.to} min={f.from || undefined} aria-label="Allocation date to" onChange={(e) => set("to", e.target.value)} /></label>
      <button type="button" className="btn btn-outline" onClick={onClear} disabled={!clearanceFiltersActive(f)}>Clear Filters</button>
    </div>
  );
}

export const RSA_COLUMNS = [
  "Trackup Number", "PIF Number", "Project Type", "Client / Billing Name", "Vehicle Number", "Driver Number", "Driver Name", "Advance Amount", "Approval Status", "Allocated Date", "Actions",
] as const;
export const RBP_COLUMNS = [
  "Trackup Number", "Project Type", "Client / Billing Name", "Vehicle Number", "Driver Number", "Driver Name", "RSA Approval Status", "Delivery Status", "RSA Approved Date", "Delivered Date", "Actions",
] as const;

export function ClearanceTable({ items, mode, hrefFor }: { items: ClearanceRow[]; mode: "RSA" | "RBP"; hrefFor: (id: string) => string }) {
  const cols = mode === "RSA" ? RSA_COLUMNS : RBP_COLUMNS;
  return (
    <div className="table-wrap">
      <table className="table rsa-hist" data-section="clearance-table">
        <thead><tr>{cols.map((c) => <th key={c}>{c === "Actions" ? <span className="sr-only">{c}</span> : c}</th>)}</tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c._id}>
              <td><strong className="num">{c.trackupNumber}</strong></td>
              {mode === "RSA" && <td>{c.pifNumber}</td>}
              <td>{c.projectType ? TYPE_LABEL[c.projectType] : "—"}</td>
              <td>{dash(c.clientName)}</td>
              <td>{c.vehicleNo}</td>
              <td>{c.driverNumber}</td>
              <td>{c.driverName}</td>
              {mode === "RSA" ? (
                <>
                  <td className={c.financialStatus === "OUTSTANDING" ? "text-danger" : undefined}>{outstandingText(c.outstandingAdvance, c.financialStatus)}</td>
                  <td><ClearanceStatusBadge status={c.status} /></td>
                  <td>{formatDateTime(c.submittedAt)}</td>
                  <td><Link href={hrefFor(c._id)} className="btn btn-outline btn-sm">Review</Link></td>
                </>
              ) : (
                <>
                  <td><span className={`badge badge-cl-${c.status.toLowerCase()}`}>{RSA_LABEL[c.status]}</span></td>
                  <td>{c.deliveryStatus ? <span className={`badge badge-dl-${c.deliveryStatus.toLowerCase()}`}>{DELIVERY_LABEL[c.deliveryStatus]}</span> : "—"}</td>
                  <td>{formatDateTime(c.approvedAt)}</td>
                  <td>{formatDateTime(c.deliveredAt)}</td>
                  <td className="inline">
                    <Link href={hrefFor(c._id)} className="btn btn-outline btn-sm">View</Link>
                    {canShowDeliver(c) && <Link href={`/rbp/on-road/deliver?id=${c._id}`} className="btn btn-primary btn-sm">Deliver</Link>}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Page { items: ClearanceRow[]; total: number; page: number; limit: number }

/** The whole list screen (cards, mass search, filters, table, pager) for either role; all filtering and paging is server-side. */
export function ClearanceList({ mode }: { mode: "RSA" | "RBP" }) {
  const base = mode === "RSA" ? "/rsa-clearances" : "/on-road-vehicles";
  const [f, setF] = useState<ClearanceFilters>(emptyClearanceFilters());
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const dq = useDebounce(f.q); // no request per keystroke; a newer request always wins over an older one
  const list = useApi<Page>(`${base}?${clearanceQuery({ ...f, q: dq }, page, limit)}`);
  const summary = useApi<ClearanceSummary & Partial<DeliverySummary>>(`${base}/summary`);
  const change = (n: ClearanceFilters) => { setF(n); setPage(1); };
  const hint = mode === "RSA" ? "Search Trackup / PIF / bill no, client, vehicle, driver number or name" : "Search Trackup / PIF no, client, project, vehicle, driver number or name";
  const labels: [string, string, string, string] = mode === "RSA" ? ["Total Submissions", "Yet to Approve", "Approved", "Rejected"] : ["Total Allocations", "Yet to Approve", "Approved", "Rejected"];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{mode === "RSA" ? "Vehicle & Driver Clearance" : "Vehicle Deliver"}</h1>
          <p className="muted">
            {mode === "RSA"
              ? "Verify driver advance details and approve or reject vehicle and driver allocations before on-road operations."
              : "Track RSA clearance of vehicle and driver allocations and deliver the approved vehicles."}
          </p>
        </div>
      </div>
      {summary.data && mode === "RSA" && <ClearanceSummaryCards s={summary.data} labels={labels} />}
      {summary.data && mode === "RBP" && <DeliverySummaryCards s={summary.data as DeliverySummary} />}
      <div className="card">
        <ClearanceFiltersBar mode={mode} f={f} onChange={change} onClear={() => change(emptyClearanceFilters())} searchHint={hint} />
        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          clearanceFiltersActive(f)
            ? <EmptyState title="No allocations match your filters" hint="Try a different search or clear the filters." />
            : <EmptyState title="No vehicle and driver allocations yet" hint={mode === "RSA" ? "Allocations appear here once RBP assigns a driver to an approved project vehicle." : "Assign a driver to a vehicle allotment to submit it for RSA clearance."} />
        ) : (
          <>
            <ClearanceTable items={list.data.items} mode={mode} hrefFor={(id) => (mode === "RSA" ? `/rsa/clearance/review?id=${id}` : `/rbp/on-road/view?id=${id}`)} />
            <RsaPager total={list.data.total} page={page} limit={limit} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- detail building blocks

export function FinancialPanel({ fin }: { fin: ClearanceFinancial }) {
  const tone = fin.status === "OUTSTANDING" || fin.status === "UNAVAILABLE" ? "bad" : "ok";
  return (
    <section className="card cl-section" data-section="driver-advance-verification">
      <h3>Driver Advance Verification</h3>
      <dl className="kv">
        <KV k="Total Advance Amount" v={formatInr(fin.totalAdvance)} />
        <KV k="Total Repaid / Settled Amount" v={fin.totalSettled === null ? "Not Available" : formatInr(fin.totalSettled)} />
        <KV k="Outstanding Advance Amount" v={<strong>{outstandingText(fin.outstanding, fin.status)}</strong>} />
      </dl>
      <div className={`cl-flag ${tone}`} role={tone === "bad" ? "alert" : "status"}>
        {financialLabel(fin.status)}{fin.status === "OUTSTANDING" ? ` — ${formatInr(fin.outstanding)} is outstanding; reject this allocation with a reason.` : ""}
      </div>
      {fin.status === "UNAVAILABLE" && <p className="muted">{fin.message}. Approval stays blocked; the outstanding amount is never assumed to be zero.</p>}
      <h4>Previous Advance Transactions</h4>
      {fin.advances.length === 0 ? <p className="muted">No advance transactions on record.</p> : (
        <div className="table-wrap">
          <table className="table"><thead><tr><th>Advance Date &amp; Time</th><th>Working Days</th><th>Advance Amount</th><th>Submitted By</th></tr></thead>
            <tbody>{fin.advances.map((a) => (<tr key={a._id}><td>{formatDateTime(a.submittedAt)}</td><td>{a.workingDays}</td><td>{formatInr(a.finalAdvanceAmount)}</td><td>{a.submittedBy}</td></tr>))}</tbody>
          </table>
        </div>
      )}
      <h4>Settlement Details</h4>
      {fin.settlementDataAvailable
        ? (fin.settlements.length === 0 ? <p className="muted">No settlements recorded.</p> : <p>{fin.settlements.length} settlement(s) totalling {formatInr(fin.totalSettled)}.</p>)
        : <p className="muted">Settlement records are not available for this driver.</p>}
    </section>
  );
}

export function DetailSections({ d }: { d: ClearanceDetail }) {
  const p = d.project, v = d.vehicle, dr = d.driver;
  return (
    <>
      <section className="card cl-section" data-section="project-information">
        <h3>Project Information</h3>
        <dl className="kv">
          <KV k="Trackup Number" v={p.trackupNumber} /><KV k="PIF Number" v={p.pifNumber} /><KV k="Bill Number" v={p.billNumber} />
          <KV k="Project Type" v={p.projectType ? TYPE_LABEL[p.projectType] : null} /><KV k="Project Name" v={p.projectName} /><KV k="Client / Billing Name" v={p.clientName} />
          <KV k="Project From Date" v={formatDate(p.projectFrom)} /><KV k="Project To Date" v={formatDate(p.projectTo)} /><KV k="Project Location" v={p.location} />
          <KV k="Approved Budget Amount" v={formatInr(p.approvedBudgetAmount)} /><KV k="RSOM Approval Status" v={p.rsomStatus} />
        </dl>
      </section>
      <section className="card cl-section" data-section="vehicle-information">
        <h3>Vehicle Information</h3>
        <dl className="kv">
          <KV k="Vehicle Number" v={v.vehicleNo} /><KV k="Make" v={v.make} /><KV k="Model" v={v.model} /><KV k="Vehicle Type" v={v.type} />
          <KV k="Vehicle Status" v={v.availabilityStatus ?? v.status} /><KV k="Vehicle Allotment Date & Time" v={formatDateTime(v.allottedAt)} />
          <KV k="Expected Release Date & Time" v={formatDateTime(v.expectedReleaseAt)} /><KV k="Next Available Date & Time" v={v.nextAvailableAt ? formatDateTime(v.nextAvailableAt) : null} />
        </dl>
        {v.documents.length > 0 && (
          <ul className="muted">{v.documents.map((x, i) => (<li key={i}>{x.section} · renewal {formatDate(x.nextRenewalDate)} {x.attachment && <a href={x.attachment.url} target="_blank" rel="noreferrer">{x.attachment.name}</a>}</li>))}</ul>
        )}
      </section>
      <section className="card cl-section" data-section="driver-information">
        <h3>Driver Information</h3>
        <dl className="kv">
          <KV k="Driver Number" v={dr.driverNumber} /><KV k="Driver Name" v={dr.driverName} /><KV k="Driver Type" v={dr.driverType ? DRIVER_TYPE[dr.driverType] ?? dr.driverType : null} />
          <KV k="Mobile Number" v={dr.mobileNumber} /><KV k="Driving Licence" v={[dr.licenceNumber, dr.licenceType].filter(Boolean).join(" · ") || null} /><KV k="Licence Expiry" v={formatDate(dr.licenceExpiryDate)} />
          <KV k="Driver Availability Status" v={dr.availabilityStatus} /><KV k="Driver Assigned Date & Time" v={formatDateTime(dr.assignedAt)} /><KV k="Driver Remarks" v={dr.remarks} />
          <KV k="Bank" v={[dr.bank.bankName, dr.bank.accountNumberMasked, dr.bank.ifscCode].filter(Boolean).join(" · ") || null} />
        </dl>
      </section>
    </>
  );
}

const historyText = (h: ClearanceHistoryRow): string => {
  const x = (h.details ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (h.action === "REJECTED") return `${x.reason ?? ""}${x.remarks ? ` — ${x.remarks}` : ""} (outstanding: ${outstandingText(x.financial?.outstanding, x.financial?.status)})`;
  if (h.action === "APPROVED") return `Outstanding advance: ${outstandingText(x.financial?.outstanding, x.financial?.status)}`;
  if (h.action === "DRIVER_CHANGED") return `${x.from?.driverNumber} ${x.from?.driverName} → ${x.to?.driverNumber} ${x.to?.driverName}`;
  if (h.action === "VEHICLE_CHANGED") return `${x.from?.vehicleNo} → ${x.to?.vehicleNo}`;
  if (h.action === "SUBMITTED" || h.action === "RESUBMITTED" || h.action === "ALLOCATED") return `${x.vehicleNo ?? ""} · ${x.driverNumber ?? ""} ${x.driverName ?? ""}`.trim();
  return "";
};

/** Version-wise history, latest first (the server sends it that way), times in IST. */
export function ClearanceHistory({ rows }: { rows: ClearanceHistoryRow[] }) {
  return (
    <section className="card cl-section" data-section="approval-history">
      <h3>Approval History</h3>
      <div className="table-wrap">
        <table className="table"><thead><tr><th>Version</th><th>Action</th><th>User</th><th>Date &amp; Time</th><th>Details</th></tr></thead>
          <tbody>{rows.map((h) => (<tr key={h._id}><td>V{h.version}</td><td>{ACTION_LABEL[h.action] ?? h.action}</td><td>{h.username} ({h.role})</td><td>{formatDateTime(h.at)}</td><td>{historyText(h)}</td></tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}
