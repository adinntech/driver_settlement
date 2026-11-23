"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import { Collapsible } from "@/components/HistorySections";
import { ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import type { Vehicle, VehicleHistoryRow } from "@/types/domain";
import { formatDate, formatDateTime } from "@/utils/format";
import { AvBadge } from "@/components/VehicleAvailability";
import { ISSUE_STATUS_LABEL, PROJECT_TYPE_LABEL, formatAt } from "@/utils/vehicleAvailability";
import { DOC_KEYS, DOC_LABEL, DOC_STATUS_LABEL, FIELD_LABEL, HISTORY_LABEL, docStatus, fmtValue } from "@/utils/vehicleForm";

export default function VehicleViewPage() {
  return (
    <AppShell role="RBP">
      <Suspense fallback={<Skeleton rows={8} />}>
        <View />
      </Suspense>
    </AppShell>
  );
}

const KV = ({ k, v }: { k: string; v: string | number | null | undefined }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);

function View() {
  const id = useSearchParams().get("id");
  const res = useApi<Vehicle>(id ? `/vehicles/${id}` : null);
  const hist = useApi<VehicleHistoryRow[]>(id ? `/vehicles/${id}/history` : null);
  if (!id) return <ErrorState message="No vehicle selected." />;
  if (res.loading) return <Skeleton rows={8} />;
  if (res.error || !res.data) return <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} />;
  const v = res.data;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/rbp/vehicles" className="back">← Back to vehicles</Link>
          <h1>{v.vehicleNo || "Unnamed draft"}</h1>
          <p className="muted">{[v.make, v.model, v.type].filter(Boolean).join(" · ") || "Details not entered yet"}</p>
        </div>
        <div className="inline">
          <span className={`badge badge-v-${v.status.toLowerCase()}`}>{v.status}</span>
          <Link href={`/rbp/vehicles/edit?id=${v._id}`} className="btn btn-primary">{v.status === "DRAFT" ? "Continue Draft" : "Edit Vehicle"}</Link>
        </div>
      </div>

      <div className="card">
        <h3 className="sub">Vehicle details</h3>
        <dl className="kv">
          <KV k="Vehicle No" v={v.vehicleNo} />
          <KV k="Make" v={v.make} />
          <KV k="Model" v={v.model} />
          <KV k="Type" v={v.type} />
          <KV k="Year Of Manufacture" v={v.yearOfManufacture} />
          <KV k="Purchase Date" v={v.purchaseDate ? formatDate(v.purchaseDate) : null} />
          <KV k="Current Running" v={v.currentRunning} />
          <KV k="Total Running" v={v.totalRunning} />
          <KV k="Stepney Status" v={v.stepneyStatus} />
          <KV k="Battery Status" v={v.batteryStatus} />
          <KV k="Condition" v={v.condition} />
          <KV k="Specification" v={v.specification} />
        </dl>
      </div>

      <div className="card av-view">
        <h3 className="sub">Availability &amp; status</h3>
        <p><AvBadge status={v.availability?.status} /></p>
        {!v.availability?.status ? (
          <p className="muted">Availability has not been set for this vehicle yet.</p>
        ) : v.availability.status === "AVAILABLE" ? (
          <dl className="kv"><KV k="Available From" v={formatAt(v.availability.availableFromDate, v.availability.availableFromTime)} /></dl>
        ) : v.availability.status === "IN_USE" ? (
          <dl className="kv">
            <KV k="Project Type" v={PROJECT_TYPE_LABEL[v.availability.project?.projectType ?? ""] ?? v.availability.project?.projectType} />
            <KV k="Project Name" v={v.availability.project?.projectName} />
            <KV k="Client / Billing Name" v={v.availability.project?.clientName} />
            <KV k="Trackup Number" v={v.availability.project?.trackupNumber} />
            <KV k="PIF Number" v={v.availability.project?.pifNumber} />
            <KV k="Project Start Date" v={v.availability.project?.startDate ? formatDate(v.availability.project.startDate) : null} />
            <KV k="Project End Date" v={v.availability.project?.endDate ? formatDate(v.availability.project.endDate) : null} />
            <KV k="Expected Release" v={formatAt(v.availability.expectedReleaseDate, v.availability.expectedReleaseTime)} />
            <KV k="Next Available" v={formatAt(v.availability.nextAvailableDate, v.availability.nextAvailableTime)} />
            <KV k="Location" v={v.availability.project?.location} />
            <KV k="Additional Remarks" v={v.availability.project?.remarks} />
          </dl>
        ) : (
          <dl className="kv">
            <KV k="Issue Category" v={v.availability.issue?.category} />
            <KV k="Issue Description / Reason" v={v.availability.issue?.description} />
            <KV k="Issue Reported" v={formatAt(v.availability.issue?.reportedDate, v.availability.issue?.reportedTime)} />
            <KV k="Expected Repair Completion" v={v.availability.issue?.expectedRepairDate ? formatAt(v.availability.issue.expectedRepairDate, v.availability.issue.expectedRepairTime) : null} />
            <KV k="Garage / Service Centre" v={v.availability.issue?.garage} />
            <KV k="Repair Remarks" v={v.availability.issue?.repairRemarks} />
            <KV k="Issue Status" v={ISSUE_STATUS_LABEL[v.availability.issue?.issueStatus ?? ""] ?? v.availability.issue?.issueStatus} />
          </dl>
        )}
        {v.allocationReview && <p className="proj-taken">⚠ {v.allocationReview}</p>}
        {v.allocationNote && <p className="muted">{v.releaseOverdue ? "⚠ " : ""}{v.allocationNote}</p>}
      </div>

      <div className="card">
        <h3 className="sub">Maintenance &amp; service</h3>
        <dl className="kv">
          <KV k="Oil Top Up On" v={v.oilTopUpOn ? formatDate(v.oilTopUpOn) : null} />
          <KV k="Grease Packing On" v={v.greasePackingOn ? formatDate(v.greasePackingOn) : null} />
          <KV k="General Check Up On" v={v.generalCheckUpOn ? formatDate(v.generalCheckUpOn) : null} />
        </dl>
      </div>

      <div className="card">
        <h3 className="sub">Documents &amp; permissions</h3>
        {DOC_KEYS.map((k) => {
          const rows = v[k];
          return (
            <div key={k} className="doc-view">
              <h4>{DOC_LABEL[k]} <span className="muted">({rows.length})</span></h4>
              {rows.length === 0 ? (
                <p className="muted">No entries.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>#</th><th>Next Renewal Date</th><th>Validity</th><th>Attachment</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((d, i) => {
                      const st = docStatus(d.nextRenewalDate);
                      return (
                        <tr key={`${d.nextRenewalDate}-${i}`}>
                          <td>{i + 1}</td>
                          <td><strong>{formatDate(d.nextRenewalDate)}</strong></td>
                          <td><span className={`badge badge-doc-${st.toLowerCase()}`}>{DOC_STATUS_LABEL[st]}</span></td>
                          <td>{d.attachment ? (d.attachment.url ? <a href={d.attachment.url} target="_blank" rel="noopener noreferrer" className="doc-file">📎 {d.attachment.name}</a> : d.attachment.name) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      <div className="card" id="history">
        <h3 className="sub">Vehicle history</h3>
        <p className="muted">Created {formatDateTime(v.createdAt)} by {v.createdBy} · Last modified {formatDateTime(v.updatedAt)} by {v.updatedBy}</p>
        {hist.loading ? (
          <Skeleton rows={3} />
        ) : hist.error || !hist.data ? (
          <ErrorState message={hist.error ?? "Failed"} onRetry={hist.reload} />
        ) : hist.data.length === 0 ? (
          <p className="muted">No history yet.</p>
        ) : (
          <div className="hist-list">
            {hist.data.map((h, i) => (
              <Collapsible
                key={h._id}
                defaultOpen={i === 0}
                tone={i === 0 ? "latest" : ""}
                head={
                  <>
                    <strong className="hist-title">{HISTORY_LABEL[h.action] ?? h.action}</strong>
                    <span className="hist-meta"><small>Updated By</small><strong>{h.username === "SYSTEM" ? "System (automatic)" : h.username}</strong></span>
                    <span className="hist-meta"><small>Date &amp; Time</small><strong>{formatDateTime(h.createdAt)}</strong></span>
                  </>
                }
              >
                {(h.previousStatus || h.newStatus) && h.previousStatus !== h.newStatus && (
                  <p className="hist-status">
                    <span>Status:</span>
                    <AvBadge status={h.previousStatus} /> <span>→</span> <AvBadge status={h.newStatus} />
                  </p>
                )}
                {h.project?.projectName && <p className="muted">Project: {h.project.projectName}{h.project.clientName ? ` · ${h.project.clientName}` : ""}{h.project.trackupNumber ? ` · ${h.project.trackupNumber}` : ""}</p>}
                {h.reason && <p className="muted">{h.reason}</p>}
                {h.issueReason && <p className="muted">Issue reason: {h.issueReason}</p>}
                {h.changes.length === 0 ? (
                  <p className="muted">No field values recorded.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Field</th><th>Previous value</th><th>Updated value</th></tr>
                    </thead>
                    <tbody>
                      {h.changes.map((c) => (
                        <tr key={c.field}>
                          <td><strong>{FIELD_LABEL[c.field] ?? c.field}</strong></td>
                          <td><s>{fmtValue(c.field, c.from)}</s></td>
                          <td><strong>{fmtValue(c.field, c.to)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Collapsible>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
