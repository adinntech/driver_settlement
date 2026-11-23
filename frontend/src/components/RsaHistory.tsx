"use client";

import { EmptyState } from "@/components/ui/Ui";
import { formatDate, formatDateTime } from "@/utils/format";
import { PAYMENT_FOR_LABEL, dash, money, type RsaPaymentRow } from "@/utils/rsa";

export interface RsaSummary {
  totalEntries: number; totalAmount: number; roadshowCount: number; roadshowAmount: number; signageCount: number; signageAmount: number;
  recentPaymentAt: string | null; createdByOptions: string[];
}

const inr = (n: number) => money(Math.round(n * 100));

/** Totals straight from the database (all payment entries, not just the page on screen). */
export function RsaSummaryCards({ s }: { s: RsaSummary }) {
  const cards: [string, string, string | null][] = [
    ["Total Payment Entries", String(s.totalEntries), null],
    ["Total Payment Amount", inr(s.totalAmount), null],
    ["Roadshow Payments", String(s.roadshowCount), inr(s.roadshowAmount)],
    ["Signage Payments", String(s.signageCount), inr(s.signageAmount)],
    ["Recent Payment Date", s.recentPaymentAt ? formatDateTime(s.recentPaymentAt) : "—", null],
  ];
  return (
    <div className="stat-row" data-section="summary-cards">
      {cards.map(([label, value, sub]) => (
        <div key={label} className={`stat${label === "Total Payment Amount" ? " accent" : ""}`}>
          <span>{label}</span>
          <strong className="rsa-stat-value">{value}</strong>
          {sub && <small className="muted">{sub}</small>}
        </div>
      ))}
    </div>
  );
}

export interface HistoryFilterState { q: string; paymentFor: string; from: string; to: string; createdBy: string; paymentStatus: string }
export const emptyHistoryFilters = (): HistoryFilterState => ({ q: "", paymentFor: "", from: "", to: "", createdBy: "", paymentStatus: "" });
export const historyFiltersActive = (f: HistoryFilterState) => !!(f.q.trim() || f.paymentFor || f.from || f.to || f.createdBy || f.paymentStatus);

/** Query string for GET /rsa/payments: every filter is applied on the server, together. */
export function historyQuery(f: HistoryFilterState, page: number, limit: number): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.paymentFor) p.set("paymentFor", f.paymentFor);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.createdBy) p.set("createdBy", f.createdBy);
  if (f.paymentStatus) p.set("paymentStatus", f.paymentStatus);
  p.set("page", String(page));
  p.set("limit", String(limit));
  return p.toString();
}

export function RsaHistoryFilters({
  f, onChange, onClear, createdByOptions,
}: { f: HistoryFilterState; onChange: (next: HistoryFilterState) => void; onClear: () => void; createdByOptions: string[] }) {
  const set = <K extends keyof HistoryFilterState>(k: K, v: HistoryFilterState[K]) => onChange({ ...f, [k]: v });
  return (
    <div className="filters-vehicle rsa-filters" data-section="history-filters">
      <input className="search-wide" aria-label="Mass search" value={f.q} onChange={(e) => set("q", e.target.value)}
        placeholder="Search payment no, trackup / PIF / bill no, client, vehicle, driver, expense description" />
      <select value={f.paymentFor} aria-label="Payment For filter" onChange={(e) => set("paymentFor", e.target.value)}>
        <option value="">All</option><option value="ROADSHOW">Roadshow</option><option value="SIGNAGE">Signage</option>
      </select>
      <select value={f.paymentStatus} aria-label="Payment status filter" onChange={(e) => set("paymentStatus", e.target.value)}>
        <option value="">All status</option><option value="ENTERED">Entered</option>
      </select>
      {createdByOptions.length > 1 && (
        <select value={f.createdBy} aria-label="Created by filter" onChange={(e) => set("createdBy", e.target.value)}>
          <option value="">All users</option>{createdByOptions.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      )}
      <label className="rsa-range">Payment date from<input type="date" value={f.from} aria-label="Payment date from" onChange={(e) => set("from", e.target.value)} /></label>
      <label className="rsa-range">to<input type="date" value={f.to} min={f.from || undefined} aria-label="Payment date to" onChange={(e) => set("to", e.target.value)} /></label>
      <button type="button" className="btn btn-outline" onClick={onClear} disabled={!historyFiltersActive(f)}>Clear Filters</button>
    </div>
  );
}

export const HISTORY_COLUMNS = [
  "Payment Number", "Trackup Number", "Project Type", "Client / Billing Name", "Vehicle Number", "Driver Name", "From Date", "To Date", "Total Payable", "Entry Date & Time", "Created By", "Actions",
] as const;

export function RsaHistoryTable({ items, onView }: { items: RsaPaymentRow[]; onView: (p: RsaPaymentRow) => void }) {
  return (
    <div className="table-wrap">
      <table className="table rsa-hist" data-section="history-table">
        <thead><tr>{HISTORY_COLUMNS.map((c) => <th key={c}>{c === "Actions" ? <span className="sr-only">{c}</span> : c}</th>)}</tr></thead>
        <tbody>
          {items.map((p) => (
            <tr key={p._id}>
              <td><strong className="num">{p.paymentNumber}</strong></td>
              <td>{p.trackupNumber}</td>
              <td>{PAYMENT_FOR_LABEL[p.paymentFor] ?? dash(p.paymentFor)}</td>
              <td>{dash(p.clientName)}</td>
              <td>{dash(p.vehicleNo)}</td>
              <td>{dash(p.driverName)}</td>
              <td>{p.campaignFromDate ? formatDate(p.campaignFromDate) : "—"}</td>
              <td>{p.campaignToDate ? formatDate(p.campaignToDate) : "—"}</td>
              <td><strong>{money(Math.round(p.totalPayable * 100))}</strong></td>
              <td>{formatDateTime(p.entryDateTime)}</td>
              <td>{p.createdBy}</td>
              <td><button type="button" className="btn btn-outline btn-sm" onClick={() => onView(p)}>View Details</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What to show when there are no rows: no payments at all, or none that match the filters. */
export function HistoryEmpty({ filtered }: { filtered: boolean }) {
  return filtered
    ? <EmptyState title="No payments match your filters" hint="Try a different search or clear the filters." />
    : <EmptyState title="No payment entries yet" hint="Click + Enter Payment to add the first one." />;
}

export function RsaPager({
  total, page, limit, onPage, onLimit,
}: { total: number; page: number; limit: number; onPage: (p: number) => void; onLimit: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pager" data-section="pager">
      <span className="muted">{total} payment(s) · page {page} of {pages}</span>
      <div className="inline">
        <label className="muted size-pick">
          Rows
          <select value={limit} onChange={(e) => onLimit(Number(e.target.value))} aria-label="Page size">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
