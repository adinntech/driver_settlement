"use client";

import VerticalSelect from "@/components/ui/VerticalSelect";
import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import AllotmentDetail, { AllotStatusBadge } from "@/components/AllotmentDetail";
import VehicleTabs from "@/components/VehicleTabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import type { Allotment } from "@/types/domain";
import { fmtInstant } from "@/utils/allotment";

interface Page { items: Allotment[]; total: number; page: number; limit: number }
const EMPTY = { q: "", vehicleNo: "", clientName: "", trackupNumber: "", pifNumber: "", projectType: "", status: "", from: "", to: "" };
type Filters = typeof EMPTY;

export default function AllotmentHistoryPage() {
  return (
    <AppShell role="RBP">
      <History />
    </AppShell>
  );
}

function History() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [open, setOpen] = useState<string | null>(null);
  const set = (k: keyof Filters, v: string) => { setF((s) => ({ ...s, [k]: v })); setPage(1); };
  const dq = useDebounce(f.q);
  const dv = useDebounce(f.vehicleNo);
  const dc = useDebounce(f.clientName);
  const dt = useDebounce(f.trackupNumber);
  const dp = useDebounce(f.pifNumber);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    for (const [k, v] of Object.entries({ ...f, q: dq, vehicleNo: dv, clientName: dc, trackupNumber: dt, pifNumber: dp })) if (v.trim()) p.set(k, v.trim());
    return p.toString();
  }, [f, dq, dv, dc, dt, dp, page, limit]);
  const list = useApi<Page>(`/vehicle-allotments?${qs}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / limit)) : 1;
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vehicle Management</h1>
          <p className="muted">Every vehicle allotment, replacement and release, latest first.</p>
        </div>
      </div>
      <VehicleTabs />

      <div className="card">
        <div className="filters-vehicle">
          <input className="search-wide" placeholder="Search vehicle, client, project, trackup, PIF, bill no" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Mass search" />
          <input placeholder="Vehicle number" value={f.vehicleNo} onChange={(e) => set("vehicleNo", e.target.value.toUpperCase())} aria-label="Vehicle number" />
          <input placeholder="Client name" value={f.clientName} onChange={(e) => set("clientName", e.target.value)} aria-label="Client name" />
          <input placeholder="Trackup number" value={f.trackupNumber} onChange={(e) => set("trackupNumber", e.target.value)} aria-label="Trackup number" />
          <input placeholder="PIF number" value={f.pifNumber} onChange={(e) => set("pifNumber", e.target.value)} aria-label="PIF number" />
          <VerticalSelect value={f.projectType} onChange={(v) => set("projectType", v)} />
          <Select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Allotment status">
            <option value="">Allotment status</option>
            <option value="ACTIVE">Active</option>
            <option value="RELEASED">Released</option>
            <option value="CHANGED">Changed</option>
          </Select>
          <DateInput value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="Allotted from" title="Allotted from" />
          <DateInput value={f.to} min={f.from || undefined} onChange={(e) => set("to", e.target.value)} aria-label="Allotted to" title="Allotted to" />
          {filtered && <button className="btn btn-ghost" onClick={() => { setF(EMPTY); setPage(1); }}>Clear Filters</button>}
        </div>

        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title={filtered ? "No allotments match these filters" : "No allotments yet"} hint={filtered ? "Try clearing some filters." : "Allot a vehicle from the Vehicle Allotment tab."} />
        ) : (
          <>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Vehicle No</th><th>Previous Vehicle</th><th>Client / Billing</th><th>Project</th><th>Vertical</th><th>Trackup No</th><th>PIF No</th><th>Bill No</th>
                    <th>Allotted</th><th>Expected Release</th><th>Next Available</th><th>Changed On</th><th>Change Reason</th><th>Status</th><th>Allotted By</th><th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((a) => (
                    <tr key={a._id}>
                      <td><strong className="num">{a.vehicleNo}</strong></td>
                      <td>{a.changedFromVehicleNo || "—"}</td>
                      <td>{a.clientName}</td>
                      <td>{a.projectName}</td>
                      <td>{a.projectType === "ROADSHOW" ? "Roadshow" : "Signage"}</td>
                      <td>{a.trackupNumber}</td>
                      <td>{a.pifNumber}</td>
                      <td>{a.billNumber || "—"}</td>
                      <td>{fmtInstant(a.allottedAt)}</td>
                      <td>{fmtInstant(a.expectedReleaseAt)}</td>
                      <td>{fmtInstant(a.nextAvailableAt)}</td>
                      <td>{fmtInstant(a.changedAt)}</td>
                      <td title={a.changeReason}>{a.changeReason || "—"}</td>
                      <td><AllotStatusBadge status={a.status} /></td>
                      <td>{a.createdBy === "SYSTEM" ? "System" : a.createdBy}</td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => setOpen(a._id)}>View Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="pager">
              <span className="muted">{list.data.total} allotment(s) · page {page} of {pages}</span>
              <div className="inline">
                <label className="muted size-pick">
                  Rows
                  <Select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} aria-label="Page size">
                    {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </label>
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {open && <AllotmentDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
