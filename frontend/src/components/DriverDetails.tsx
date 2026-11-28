"use client";

import ReadMore from "@/components/ui/ReadMore";
import { DriverAvBadge } from "@/components/DriverAvailability";
import type { Driver, DriverHistoryRow } from "@/types/domain";
import {
  HISTORY_ACTION_LABEL, HISTORY_FIELD_LABEL, historyStatus, historyValue, latestFirst,
} from "@/utils/driverAvailability";
import { DRIVER_TYPE_LABEL, fmtLicenceExpiry } from "@/utils/driverForm";
import { formatDate, formatDateTime, formatInr } from "@/utils/format";
import { PROJECT_TYPE_LABEL, formatAt } from "@/utils/vehicleAvailability";

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);

/** Availability details: only the fields that belong to the current status are shown. */
export function DriverAvailabilityDetails({ d }: { d: Driver }) {
  const a = d.availability;
  return (
    <div className="card" data-section="availability">
      <h3 className="sub">Availability details</h3>
      {!a?.status ? (
        <p className="muted">Availability has not been set for this driver yet. Edit the driver to choose a status.</p>
      ) : (
        <dl className="kv">
          <KV k="Current Status" v={<DriverAvBadge status={a.status} />} />
          {a.status === "AVAILABLE" && <KV k="Available From" v={formatAt(a.availableFromDate, a.availableFromTime)} />}
          {a.status === "IN_USE" && (
            <>
              <KV k="Project Type" v={a.project?.projectType ? PROJECT_TYPE_LABEL[a.project.projectType] ?? a.project.projectType : null} />
              <KV k="Project Name" v={a.project?.projectName} />
              <KV k="Client / Billing Name" v={a.project?.clientName} />
              <KV k="Trackup Number" v={a.project?.trackupNumber} />
              <KV k="PIF Number" v={a.project?.pifNumber} />
              <KV k="Project From Date" v={a.project?.startDate ? formatDate(a.project.startDate) : null} />
              <KV k="Project To Date" v={a.project?.endDate ? formatDate(a.project.endDate) : null} />
              <KV k="Additional Remarks" v={a.project?.remarks && <ReadMore>{a.project?.remarks}</ReadMore>} />
            </>
          )}
          {a.status === "NOT_AVAILABLE" && (
            <>
              <KV k="Reason Category" v={a.notAvailable?.category} />
              <KV k="Unavailable Reason" v={a.notAvailable?.reason && <ReadMore>{a.notAvailable?.reason}</ReadMore>} />
              <KV k="Unavailable From" v={a.notAvailable?.fromDate ? formatDate(a.notAvailable.fromDate) : null} />
              <KV k="Expected Available Date" v={a.notAvailable?.expectedAvailableDate ? formatDate(a.notAvailable.expectedAvailableDate) : null} />
              <KV k="Additional Remarks" v={a.notAvailable?.remarks && <ReadMore>{a.notAvailable?.remarks}</ReadMore>} />
            </>
          )}
          <KV k="Last Status Update" v={a.lastStatusUpdatedAt ? `${formatDateTime(a.lastStatusUpdatedAt)} by ${a.lastStatusUpdatedBy ?? "—"}` : null} />
        </dl>
      )}
    </div>
  );
}

/** Complete chronological history, latest first: every row shows the status move, previous / updated values, reason, who and when. */
export function DriverHistoryList({ rows }: { rows: DriverHistoryRow[] }) {
  const sorted = latestFirst(rows);
  return (
    <div className="card" data-section="history">
      <h3 className="sub">Driver history</h3>
      {sorted.length === 0 ? (
        <p className="muted">No history yet.</p>
      ) : (
        <ol className="drv-history">
          {sorted.map((h) => (
            <li key={h._id} className="drv-hist-item">
              <div className="drv-hist-head">
                <strong>{HISTORY_ACTION_LABEL[h.action] ?? h.action}</strong>
                <span className="muted">{formatDateTime(h.createdAt)} · {h.username}</span>
              </div>
              {(h.previousStatus || h.newStatus) && (
                <p className="drv-hist-status">
                  <span>Previous status: <strong>{historyStatus(h.previousStatus)}</strong></span>
                  <span>New status: <strong>{historyStatus(h.newStatus)}</strong></span>
                </p>
              )}
              {h.reason && <p className="drv-hist-reason"><ReadMore>Reason: {h.reason}</ReadMore></p>}
              {h.changes.length > 0 && (
                <table className="table drv-hist-changes">
                  <thead><tr><th>Field</th><th>Previous value</th><th>Updated value</th></tr></thead>
                  <tbody>
                    {h.changes.map((c) => (
                      <tr key={c.field}>
                        <td>{HISTORY_FIELD_LABEL[c.field] ?? c.field}</td>
                        <td>{historyValue(c.from)}</td>
                        <td>{historyValue(c.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function DriverDetails({ d, history }: { d: Driver; history?: DriverHistoryRow[] }) {
  return (
    <>
      <div className="card">
        <h3 className="sub">Driver details</h3>
        <dl className="kv">
          <KV k="Driver No" v={<strong className="num">{d.driverNumber}</strong>} />
          <KV k="Name" v={d.driverName} />
          <KV k="Driver Type" v={DRIVER_TYPE_LABEL[d.driverType]} />
          <KV k="Mobile No" v={d.mobileNumber} />
          <KV k="Address" v={d.address} />
          <KV k="Salary" v={formatInr(d.salary)} />
          <KV k="Status" v={d.status === "ACTIVE" ? "Active" : "Inactive"} />
        </dl>
      </div>
      <DriverAvailabilityDetails d={d} />
      <div className="card">
        <h3 className="sub">Bank details</h3>
        <dl className="kv">
          <KV k="Account Name" v={d.accountName} />
          <KV k="Account No" v={d.accountNumber} />
          <KV k="IFSC Code" v={d.ifscCode} />
          <KV k="Bank Name" v={d.bankName} />
        </dl>
      </div>
      <div className="card">
        <h3 className="sub">Licence</h3>
        <dl className="kv">
          <KV k="Licence No" v={d.licenceNumber} />
          <KV k="Licence Type" v={d.licenceType} />
          <KV k="Licence Expiry Date" v={fmtLicenceExpiry(d.licenceExpiryDate)} />
          <KV k="Attachment" v={d.attachment ? (d.attachment.url ? <a href={d.attachment.url} target="_blank" rel="noopener noreferrer" className="doc-file">📎 {d.attachment.name}</a> : d.attachment.name) : null} />
        </dl>
      </div>
      {history && <DriverHistoryList rows={history} />}
      <p className="muted">Created {formatDateTime(d.createdAt)} by {d.createdBy} · Last modified {formatDateTime(d.updatedAt)} by {d.updatedBy}</p>
    </>
  );
}
