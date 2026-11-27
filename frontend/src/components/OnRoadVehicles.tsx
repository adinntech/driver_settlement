"use client";

import VerticalSelect from "@/components/ui/VerticalSelect";
import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import BulkPaymentModal from "@/components/BulkPaymentModal";
import TableWrap from "@/components/ui/TableWrap";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDate, formatDateTime } from "@/utils/format";
import { dailyPaymentHref, paymentsBase } from "@/utils/settlement";

export interface OnRoadRow {
  clearanceId: string; trackingVehicle: string; allotment: string; trackupNumber: string; pifNumber: string;
  projectType: string | null; clientName: string | null; projectName: string | null; vehicleNo: string | null; driverNumber: string | null; driverName: string | null;
  campaignFromDate: string | null; campaignToDate: string | null; deliveredAt: string | null; deliveredBy: string | null;
  requestedVehicleType?: string | null;
  dailyPayments: { count: number; pending: number; rejected: number; lastPaidUpTo: string | null };
}

/** Short daily-payment state for one on-road vehicle. */
export function dailyPaymentText(p: OnRoadRow["dailyPayments"]): string {
  if (!p.count) return "No daily payments yet";
  const parts = [`${p.count} payment${p.count > 1 ? "s" : ""}`];
  if (p.pending) parts.push(`${p.pending} pending RSOM`);
  if (p.rejected) parts.push(`${p.rejected} rejected`);
  if (p.lastPaidUpTo) parts.push(`up to ${formatDate(p.lastPaidUpTo)}`);
  return parts.join(" · ");
}

/**
 * On Road Vehicles (RBP + RSA): vehicles that were RSA-approved and delivered and are still on their project. Daily Vehicle
 * Payments start here and open the existing payment form (same workflow, permissions and approval by RSOM).
 */
export default function OnRoadVehicles({ role }: { role: "RBP" | "RSA" }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounce(q, 300);
  const qs = new URLSearchParams({ page: String(page), limit: "25", ...(dq.trim() ? { q: dq.trim() } : {}), ...(type ? { projectType: type } : {}) });
  const list = useApi<{ items: OnRoadRow[]; total: number; page: number; limit: number }>(`/settlements/on-road?${qs}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1;
  // Bulk Payment is RBP only. Only rows on screen count as selected; changing page or filter clears the selection.
  const bulk = role === "RBP";
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<OnRoadRow[] | null>(null);
  const rows = list.data?.items ?? [];
  const selected = rows.filter((r) => picked.has(r.trackingVehicle));
  const allPicked = rows.length > 0 && selected.length === rows.length;
  const clear = () => setPicked(new Set());
  const toggle = (tv: string) => setPicked((s) => { const next = new Set(s); if (!next.delete(tv)) next.add(tv); return next; });

  return (
    <AppShell role={role}>
      <div className="page-head">
        <div>
          <h1>On Road Vehicles</h1>
          <p className="muted">Delivered vehicles currently on their project. Enter Daily Vehicle Payments here; they go to RSOM for approval as before.</p>
        </div>
        <div className="inline ds-gap">
          <Link href={paymentsBase(role)} className="btn btn-outline">All Driver Payments</Link>
        </div>
      </div>
      <div className="card filters">
        <input className="search-wide" placeholder="Search trackup no, PIF, client, vehicle no, driver" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); clear(); }} aria-label="Search on road vehicles" />
        <VerticalSelect value={type} onChange={(v) => { setType(v); setPage(1); clear(); }} />
      </div>
      {list.loading && !list.data ? (
        <Skeleton rows={6} />
      ) : list.error || !list.data ? (
        <ErrorState message={list.error ?? "Could not load on road vehicles"} onRetry={list.reload} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No vehicles on road" hint="A vehicle appears here once RSA has approved it and it has been delivered in Vehicle Deliver." />
      ) : (
        <div className="card">
          {selected.length > 0 && (
            <div className="inline ds-gap">
              <span>{selected.length} vehicle{selected.length > 1 ? "s" : ""} selected</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaying(selected)}>Bulk Payment</button>
            </div>
          )}
          <TableWrap>
            <table className="table" data-section="on-road-vehicles">
              <thead>
                <tr>
                  {bulk && (
                    <th>
                      <input type="checkbox" aria-label="Select all vehicles" checked={allPicked}
                        ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allPicked; }}
                        onChange={() => setPicked(new Set(allPicked ? [] : rows.map((r) => r.trackingVehicle)))} />
                    </th>
                  )}
                  <th>Trackup No</th><th>PIF No</th><th>Client</th><th>Vertical</th><th>Vehicle No</th><th>Driver</th><th>Campaign</th><th>Delivered</th><th>Daily Payments</th><th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.clearanceId}>
                    {bulk && <td><input type="checkbox" aria-label={`Select PIF ${r.pifNumber}`} checked={picked.has(r.trackingVehicle)} onChange={() => toggle(r.trackingVehicle)} /></td>}
                    <td className="num">{r.trackupNumber}</td>
                    <td className="num">{r.pifNumber}</td>
                    <td>{r.clientName ?? "—"}</td>
                    <td>{r.projectType === "ROADSHOW" ? "Roadshow" : r.projectType === "SIGNAGE" ? "Signage" : "—"}</td>
                    <td className="num">{r.vehicleNo ?? "—"}{r.requestedVehicleType && <><br /><small className="muted">{r.requestedVehicleType}</small></>}</td>
                    <td>{r.driverName ?? "—"}{r.driverNumber ? <small className="muted"> · {r.driverNumber}</small> : null}</td>
                    <td>{r.campaignFromDate ? `${formatDate(r.campaignFromDate)} → ${formatDate(r.campaignToDate)}` : "—"}</td>
                    <td><div className="av-cell"><span>{formatDateTime(r.deliveredAt)}</span>{r.deliveredBy && <small>by {r.deliveredBy}</small>}</div></td>
                    <td>{dailyPaymentText(r.dailyPayments)}</td>
                    <td>
                      <div className="inline row-actions">
                        <Link href={dailyPaymentHref(role, r.trackingVehicle)} className="btn btn-primary btn-sm">+ Daily Vehicle Payment</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {pages > 1 && (
            <div className="pager">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); clear(); }}>Previous</button>
              <span className="muted">Page {page} of {pages} · {list.data.total} vehicles</span>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => { setPage((p) => p + 1); clear(); }}>Next</button>
            </div>
          )}
        </div>
      )}
      {paying && (
        <BulkPaymentModal
          vehicles={paying}
          onClose={(submitted) => {
            setPaying(null);
            setPicked((s) => new Set([...s].filter((tv) => !submitted.includes(tv))));
            list.reload();
          }}
        />
      )}
    </AppShell>
  );
}
