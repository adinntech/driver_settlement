"use client";

import TableWrap from "@/components/ui/TableWrap";
import Select from "@/components/ui/Select";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import { AllotModal, AssignDriverModal, ChangeDriverModal, ChangeModal, ExtendModal, ReleaseModal } from "@/components/AllotmentModals";
import { AllotmentDriverCell } from "@/components/AllotmentDriver";
import VehicleTabs from "@/components/VehicleTabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import { useDebounce } from "@/hooks/useDebounce";
import type { AllotmentProject } from "@/types/domain";
import { fmtInstant, projectPeriod } from "@/utils/allotment";
import { formatDate, formatInr } from "@/utils/format";

interface Page { items: AllotmentProject[]; total: number; page: number; limit: number }
type Action = { kind: "allot" | "change" | "extend" | "release" | "assignDriver" | "changeDriver"; project: AllotmentProject } | null;

export default function AllotmentPage() {
  return (
    <AppShell role="RBP">
      <Allotment />
    </AppShell>
  );
}

function Allotment() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [action, setAction] = useState<Action>(null);
  const dq = useDebounce(q);
  const list = useApi<Page>(`/vehicle-allotments/projects?q=${encodeURIComponent(dq.trim())}&page=${page}&limit=${limit}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / limit)) : 1;
  const done = () => { setAction(null); list.reload(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vehicle Management</h1>
          <p className="muted">Allot available vehicles to RSOM-approved projects.</p>
        </div>
      </div>
      <VehicleTabs />

      <div className="card">
        <div className="filters-vehicle">
          <input className="search-wide" placeholder="Search client, project, trackup no, PIF no, job sheet, roadshow / signage" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search approved projects" />
          {q && <button className="btn btn-ghost" onClick={() => { setQ(""); setPage(1); }}>Clear Filters</button>}
        </div>
        <p className="av-note-strong">Only projects whose latest budget is approved by RSOM are listed.</p>

        {list.loading ? (
          <Skeleton rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title={q ? "No approved project matches" : "No approved projects yet"} hint={q ? "Try clearing the search." : "A project appears here once RSOM approves its budget."} />
        ) : (
          <>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Client / Billing</th><th>Type</th><th>Trackup No</th><th>PIF No</th><th>Bill No</th><th>Project</th><th>Period</th>
                    <th>Vehicles</th><th>Approved Budget</th><th>Approved On</th><th>Budget</th><th>Allotted Vehicle</th><th>Driver</th><th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p.trackingVehicle}>
                      <td>{p.clientName}</td>
                      <td>{p.projectType === "ROADSHOW" ? "Roadshow" : "Signage"}</td>
                      <td><strong className="num">{p.trackupNumber}</strong></td>
                      <td><strong className="num">{p.pifNumber}</strong></td>
                      <td>{p.billNumber || "—"}</td>
                      <td>{p.projectName}</td>
                      <td>{projectPeriod(p.startDate, p.endDate, formatDate)}</td>
                      <td>{p.vehicleCount ?? "—"}</td>
                      <td>{formatInr(p.budgetAmount)}</td>
                      <td>{fmtInstant(p.approvedAt)}</td>
                      <td><span className="badge badge-av-green">Approved</span></td>
                      <td>
                        {p.allotment ? (
                          <div className="av-cell">
                            <strong className="num">{p.allotment.vehicleNo}</strong>
                            <small>Allotted {fmtInstant(p.allotment.allottedAt)}</small>
                            <small>Next available {fmtInstant(p.allotment.nextAvailableAt)}</small>
                          </div>
                        ) : (
                          <span className="muted">Not allotted</span>
                        )}
                      </td>
                      <td><AllotmentDriverCell allotment={p.allotment} /></td>
                      <td>
                        <div className="inline row-actions">
                          {p.allotment ? (
                            <>
                              <button className="btn btn-outline btn-sm" onClick={() => setAction({ kind: "change", project: p })}>Change Vehicle</button>
                              {p.allotment.driver ? (
                                <button className="btn btn-outline btn-sm" onClick={() => setAction({ kind: "changeDriver", project: p })}>Change Driver</button>
                              ) : (
                                <button className="btn btn-outline btn-sm" onClick={() => setAction({ kind: "assignDriver", project: p })}>Assign Driver</button>
                              )}
                              <button className="btn btn-ghost btn-sm" onClick={() => setAction({ kind: "extend", project: p })}>Extend</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setAction({ kind: "release", project: p })}>Release</button>
                            </>
                          ) : (
                            <button className="btn btn-primary btn-sm" onClick={() => setAction({ kind: "allot", project: p })}>Allot Vehicle</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="pager">
              <span className="muted">{list.data.total} project(s) · page {page} of {pages}</span>
              <div className="inline">
                <label className="muted size-pick">
                  Rows
                  <Select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} aria-label="Page size">
                    {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </label>
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {action?.kind === "allot" && <AllotModal project={action.project} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "change" && <ChangeModal project={action.project} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "extend" && <ExtendModal project={action.project} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "assignDriver" && action.project.allotment && (
        <AssignDriverModal target={{ _id: action.project.allotment._id, vehicleNo: action.project.allotment.vehicleNo, trackupNumber: action.project.trackupNumber, projectName: action.project.projectName }} onClose={() => setAction(null)} onDone={done} />
      )}
      {action?.kind === "changeDriver" && action.project.allotment?.driver && (
        <ChangeDriverModal target={{ _id: action.project.allotment._id, vehicleNo: action.project.allotment.vehicleNo, trackupNumber: action.project.trackupNumber, projectName: action.project.projectName }}
          current={action.project.allotment.driver} onClose={() => setAction(null)} onDone={done} />
      )}
      {action?.kind === "release" && <ReleaseModal project={action.project} onClose={() => setAction(null)} onDone={done} />}
    </>
  );
}
