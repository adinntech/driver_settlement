"use client";

import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { ConfirmDialog, EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { useApi } from "@/hooks/useApi";
import StatCard from "@/components/ui/StatCard";
import { useDebounce } from "@/hooks/useDebounce";
import { request } from "@/services/api";
import type { Vehicle } from "@/types/domain";
import { formatDate, formatDateTime } from "@/utils/format";
import { DOC_STATUS_LABEL, type DocStatus } from "@/utils/vehicleForm";
import { AV_LABEL, AV_STATUSES, expectedReleaseText, inUseRemarks, issueReasonText, nextAvailableText } from "@/utils/vehicleAvailability";
import { AvBadge } from "@/components/VehicleAvailability";
import VehicleTabs from "@/components/VehicleTabs";
import { BulkImportButton } from "@/components/BulkImport";

interface Summary { total: number; active: number; draft: number; maintenanceDue: number; expiringSoon: number; availableNow?: number; inUse?: number; withIssue?: number; rules: { expiringDays: number; maintenanceDueDays: number } }
interface Page { items: Vehicle[]; total: number; page: number; limit: number }

const EMPTY = { q: "", availabilityStatus: "", docStatus: "", docType: "" };
type Filters = typeof EMPTY;
const STATUS_TXT = { DRAFT: "Draft", ACTIVE: "Active", INACTIVE: "Inactive" } as const;

export default function VehiclesPage() {
  return (
    <AppShell role="RBP">
      <Vehicles />
    </AppShell>
  );
}

const DocCell = ({ status, expiry }: { status: DocStatus; expiry?: string | null }) => (
  <span className="doc-cell">
    <span className={`badge badge-doc-${status.toLowerCase()}`}>{DOC_STATUS_LABEL[status]}</span>
    {expiry && <small className="muted">{formatDate(expiry)}</small>}
  </span>
);

function Vehicles() {
  const toast = useToast();
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [del, setDel] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Filters, v: string) => {
    setF((s) => ({ ...s, [k]: v }));
    setPage(1);
  };
  const dq = useDebounce(f.q); // typing in the search box does not fire a request per keystroke

  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    for (const [k, v] of Object.entries({ ...f, q: dq })) if (v.trim()) p.set(k, v.trim());
    return p.toString();
  }, [f, dq, page, limit]);

  const summary = useApi<Summary>("/vehicles/summary");
  const list = useApi<Page>(`/vehicles?${qs}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / limit)) : 1;
  const filtered = Object.values(f).some(Boolean);

  async function remove() {
    if (!del) return;
    setBusy(true);
    try {
      await request(`/vehicles/${del._id}`, "DELETE");
      toast("Draft deleted");
      setDel(null);
      list.reload();
      summary.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vehicle Management</h1>
          <p className="muted">Maintain vehicles, documents and service dates.</p>
        </div>
        <div className="inline ds-gap">
          <BulkImportButton kind="vehicles" onImported={() => { list.reload(); summary.reload(); }} />
          <Link href="/rbp/vehicles/edit" className="btn btn-primary">+ Add Vehicle</Link>
        </div>
      </div>

      <VehicleTabs />

      <div className="stat-row">
        {summary.loading || !summary.data ? (
          Array.from({ length: 8 }, (_, i) => <div key={i} className="stat skeleton" style={{ height: 84 }} />)
        ) : (
          <>
            <StatCard label="Total Vehicles" value={summary.data.total} active={!filtered} onClick={() => { setF(EMPTY); setPage(1); }} title="Show all vehicles" />
            <StatCard label="Active Vehicles" value={summary.data.active} tone="stat-ok" />
            <StatCard label="Draft Vehicles" value={summary.data.draft} />
            <StatCard label="Requiring Maintenance" value={summary.data.maintenanceDue} tone={summary.data.maintenanceDue ? "accent" : undefined} title={`Last service older than ${summary.data.rules.maintenanceDueDays} days`} />
            <StatCard label="Insurance / FC Expiring" value={summary.data.expiringSoon} tone={summary.data.expiringSoon ? "accent" : undefined}
              active={f.docStatus === "EXPIRING_SOON"} onClick={() => set("docStatus", f.docStatus === "EXPIRING_SOON" ? "" : "EXPIRING_SOON")}
              title={`Insurance / FC expired or expiring within ${summary.data.rules.expiringDays} days`} />
            {([["AVAILABLE", "Available Now", summary.data.availableNow, "stat-av-green"], ["IN_USE", "In Use – Another Project", summary.data.inUse, "stat-av-blue"], ["ISSUE", "Vehicle Issue", summary.data.withIssue, "stat-av-red"]] as const).map(([k, label, n, tone]) => (
              <StatCard key={k} label={label} value={n ?? 0} tone={tone} active={f.availabilityStatus === k} onClick={() => set("availabilityStatus", f.availabilityStatus === k ? "" : k)} />
            ))}
          </>
        )}
      </div>

      <div className="card">
        <div className="filters-vehicle">
          <input className="search-wide" placeholder="Search vehicle no, make, model, type, trackup no, PIF no, project name" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Mass search" />
          <Select value={f.availabilityStatus} onChange={(e) => set("availabilityStatus", e.target.value)} aria-label="Vehicle availability">
            <option value="">Availability: All</option>
            {AV_STATUSES.map((st) => <option key={st} value={st}>{AV_LABEL[st]}</option>)}
          </Select>
          <Select value={f.docStatus} onChange={(e) => set("docStatus", e.target.value)} aria-label="Document expiry">
            <option value="">Document expiry: All</option>
            <option value="VALID">Valid</option>
            <option value="EXPIRING_SOON">Expiring Soon</option>
            <option value="EXPIRED">Expired</option>
            <option value="NONE">No Expiry</option>
          </Select>
          <Select value={f.docType} onChange={(e) => set("docType", e.target.value)} aria-label="Document type">
            <option value="">All Documents</option>
            <option value="FC">FC</option>
            <option value="INSURANCE">Insurance</option>
          </Select>
          {filtered && (
            <button className="btn btn-ghost" onClick={() => { setF(EMPTY); setPage(1); }}>Clear Filters</button>
          )}
        </div>

        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title={filtered ? "No vehicles match these filters" : "No vehicles yet"} hint={filtered ? "Try clearing some filters." : "Click Add Vehicle to create the first one."} />
        ) : (
          <>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Vehicle No</th><th>Make</th><th>Model</th><th>Type</th><th>Year</th><th>Current Running</th>
                    <th>Insurance</th><th>FC</th><th>Availability</th><th>Current Project</th><th>Trackup No</th><th>PIF No</th><th>Client</th><th>Remarks</th><th>Expected Release</th><th>Next Available</th>
                    <th>Issue Reason</th><th>Status</th><th>Last Updated</th><th>Created</th><th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((v) => (
                    <tr key={v._id}>
                      <td><strong className="num">{v.vehicleNo || <span className="muted">Not set</span>}</strong></td>
                      <td>{v.make || "—"}</td>
                      <td>{v.model || "—"}</td>
                      <td>{v.type || "—"}</td>
                      <td>{v.yearOfManufacture ?? "—"}</td>
                      <td>{v.currentRunning ?? "—"}</td>
                      <td><DocCell status={v.insuranceStatus} expiry={v.insuranceExpiry} /></td>
                      <td><DocCell status={v.fcStatus} expiry={v.fcExpiry} /></td>
                      <td>
                        <div className="av-cell">
                          <AvBadge status={v.availability?.status} />
                          {v.releaseOverdue && <small className="proj-taken">Releasing automatically</small>}
                          {v.allocationReview && <small className="proj-taken" title={v.allocationReview}>Budget review needed</small>}
                        </div>
                      </td>
                      <td>{v.availability?.status === "IN_USE" ? v.availability.project?.projectName || "—" : "—"}</td>
                      <td>{v.availability?.status === "IN_USE" ? v.availability.project?.trackupNumber || "—" : "—"}</td>
                      <td>{v.availability?.status === "IN_USE" ? v.availability.project?.pifNumber || "—" : "—"}</td>
                      <td>{v.availability?.status === "IN_USE" ? v.availability.project?.clientName || "—" : "—"}</td>
                      <td className="cell-remarks" title={inUseRemarks(v)}>{inUseRemarks(v) || "—"}</td>
                      <td>{expectedReleaseText(v)}</td>
                      <td><strong>{nextAvailableText(v)}</strong></td>
                      <td title={issueReasonText(v)}>{issueReasonText(v)}</td>
                      <td><span className={`badge badge-v-${v.status.toLowerCase()}`}>{STATUS_TXT[v.status]}</span></td>
                      <td><div className="av-cell"><span>{v.updatedBy === "SYSTEM" ? "System (automatic)" : v.updatedBy}</span><small>{formatDateTime(v.updatedAt)}</small></div></td>
                      <td>{formatDateTime(v.createdAt)}</td>
                      <td>
                        <div className="inline row-actions">
                          <Link href={`/rbp/vehicles/view?id=${v._id}`} className="btn btn-outline btn-sm">View</Link>
                          <Link href={`/rbp/vehicles/edit?id=${v._id}`} className="btn btn-outline btn-sm">{v.status === "DRAFT" ? "Continue" : "Edit"}</Link>
                          <Link href={`/rbp/vehicles/view?id=${v._id}#history`} className="btn btn-ghost btn-sm">History</Link>
                          {v.status === "DRAFT" && <button className="btn btn-ghost btn-sm btn-del" onClick={() => setDel(v)}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="pager">
              <span className="muted">{list.data.total} vehicle(s) · page {page} of {pages}</span>
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

      {del && (
        <ConfirmDialog
          title="Delete this draft?"
          message={`${del.vehicleNo || "This draft"} will be removed. Only drafts can be deleted; its history is kept.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setDel(null)}
        />
      )}
    </>
  );
}
