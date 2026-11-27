"use client";

import VerticalSelect from "@/components/ui/VerticalSelect";
import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import Link from "next/link";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";
import { PAYMENT_FOR_LABEL, PAYMENT_STATUS_LABEL, dash, type RsaProjectRow } from "@/utils/rsa";

export const RSA_COLUMNS = [
  "Trackup No (JS)", "PIF No", "Vertical", "Client / Billing Name", "Vehicle No", "Driver No", "Driver Name", "Campaign From", "Campaign To",
  "Approved Budget", "Payment Status", "Last Payment", "",
] as const;

export interface RsaFilterState { q: string; projectType: string; paymentStatus: string; from: string; to: string }
export const emptyRsaFilters = (): RsaFilterState => ({ q: "", projectType: "", paymentStatus: "", from: "", to: "" });
export const rsaFiltersActive = (f: RsaFilterState) => !!(f.q.trim() || f.projectType || f.paymentStatus || f.from || f.to);

/** Query string for the eligible-projects API (server-side search / filters / pagination). */
export function rsaQuery(f: RsaFilterState, page: number, limit: number): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.projectType) p.set("projectType", f.projectType);
  if (f.paymentStatus) p.set("paymentStatus", f.paymentStatus);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  p.set("page", String(page));
  p.set("limit", String(limit));
  return p.toString();
}

export function RsaFilters({ f, onChange, onClear }: { f: RsaFilterState; onChange: (next: RsaFilterState) => void; onClear: () => void }) {
  const set = <K extends keyof RsaFilterState>(k: K, v: RsaFilterState[K]) => onChange({ ...f, [k]: v });
  return (
    <div className="filters-vehicle rsa-filters">
      <input className="search-wide" placeholder="Search trackup no, client / billing name, vehicle no, driver name" value={f.q} aria-label="Mass search" onChange={(e) => set("q", e.target.value)} />
      <VerticalSelect value={f.projectType} onChange={(v) => set("projectType", v)} />
      <Select value={f.paymentStatus} aria-label="Payment status filter" onChange={(e) => set("paymentStatus", e.target.value)}>
        <option value="">All payment status</option><option value="PENDING">{PAYMENT_STATUS_LABEL.PENDING}</option><option value="ENTERED">{PAYMENT_STATUS_LABEL.ENTERED}</option>
      </Select>
      <label className="rsa-range">Campaign from<DateInput value={f.from} aria-label="Date range from" onChange={(e) => set("from", e.target.value)} /></label>
      <label className="rsa-range">to<DateInput value={f.to} min={f.from || undefined} aria-label="Date range to" onChange={(e) => set("to", e.target.value)} /></label>
      <button type="button" className="btn btn-outline" onClick={onClear} disabled={!rsaFiltersActive(f)}>Clear Filters</button>
    </div>
  );
}

export function RsaProjectTable({ items, actionLabel = "Payment Entry" }: { items: RsaProjectRow[]; actionLabel?: string }) {
  return (
    <TableWrap>
      <table className="table rsa-list">
        <thead><tr>{RSA_COLUMNS.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.trackingVehicle}>
              <td><strong className="num">{r.trackupNumber}</strong></td>
              <td>{r.pifNumber}</td>
              <td>{PAYMENT_FOR_LABEL[r.projectType] ?? r.projectType}</td>
              <td>{r.clientName}</td>
              <td>{dash(r.vehicleNo)}</td>
              <td>{dash(r.driverNumber)}</td>
              <td>{dash(r.driverName)}</td>
              <td>{r.campaignFromDate ? formatDate(r.campaignFromDate) : "—"}</td>
              <td>{r.campaignToDate ? formatDate(r.campaignToDate) : "—"}</td>
              <td>{r.approvedBudgetAmount === null ? "—" : formatInr(r.approvedBudgetAmount)}</td>
              <td><span className={`badge ${r.paymentStatus === "ENTERED" ? "badge-av-green" : "badge-av-none"}`}>{PAYMENT_STATUS_LABEL[r.paymentStatus]}</span>{r.paymentCount > 0 ? <small className="muted"> ({r.paymentCount})</small> : null}</td>
              <td>{r.lastPaymentAt ? formatDateTime(r.lastPaymentAt) : "—"}</td>
              <td><Link href={`/rsa/payment?id=${r.trackingVehicle}`} className="btn btn-primary btn-sm">{actionLabel}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
