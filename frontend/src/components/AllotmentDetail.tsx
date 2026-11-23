"use client";

import { useState } from "react";
import { AllotmentDriverSection } from "@/components/AllotmentDriver";
import { AssignDriverModal, ChangeDriverModal } from "@/components/AllotmentModals";
import { ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import type { Allotment, AllotmentDetailData } from "@/types/domain";
import { formatDeduction } from "@/utils/driverBank";
import { ALLOT_STATUS_LABEL, EVENT_LABEL, fmtInstant, projectPeriod } from "@/utils/allotment";
import { formatDate } from "@/utils/format";

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);
export const AllotStatusBadge = ({ status }: { status: Allotment["status"] }) => (
  <span className={`badge badge-al-${status.toLowerCase()}`}>{ALLOT_STATUS_LABEL[status]}</span>
);
const vname = (v?: { vehicleNo?: string; vehicleMake?: string; vehicleModel?: string } | null) =>
  v?.vehicleNo ? [v.vehicleNo, [v.vehicleMake, v.vehicleModel].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "—";
const who = (u: string) => (u === "SYSTEM" ? "System (automatic)" : u);

/** Short human text for one timeline row. */
export function eventText(action: string, d: Record<string, unknown> | null): string {
  const x = d ?? {};
  if (action === "VEHICLE_CHANGED") return `${x.fromVehicleNo} → ${x.toVehicleNo}. Reason: ${x.reason}`;
  if (action === "ALLOTTED") return x.replacing ? `${x.vehicleNo} allotted, replacing ${x.replacing}` : `${x.vehicleNo} allotted`;
  if (action === "RELEASED") return String(x.reason ?? "Released");
  if (action === "EXTENDED") return `Schedule changed${x.reason ? `: ${x.reason}` : ""}`;
  if (action === "DRIVER_ASSIGNED") return `${x.driverNumber} ${x.driverName ?? ""} assigned${x.later ? " (assigned later)" : " with the vehicle"}`.replace("  ", " ");
  if (action === "DRIVER_CHANGED") {
    const f = (x.from ?? {}) as Record<string, unknown>;
    const t = (x.to ?? {}) as Record<string, unknown>;
    const ded = Number(x.travelAmountDeduction ?? 0);
    return `${f.driverNumber} → ${t.driverNumber}. Reason: ${x.reason}${ded > 0 ? `. Travel amount deduction: ${formatDeduction(ded)}` : ""}`;
  }
  if (action === "DRIVER_BANK_UPDATED") {
    const fields = ((x.changes ?? []) as { field: string }[]).map((c) => c.field).join(", ");
    return `${x.driverNumber ?? "Driver"} bank details updated${fields ? ` (${fields})` : ""}`;
  }
  if (action === "DRIVER_RELEASED") return `${x.driverNumber ?? "Driver"} released${x.reason ? `. ${x.reason}` : ""}`;
  return EVENT_LABEL[action] ?? action;
}

export default function AllotmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const res = useApi<AllotmentDetailData>(`/vehicle-allotments/${id}`);
  const [act, setAct] = useState<"assign" | "change" | null>(null);
  const d = res.data;
  if (act && d) {
    const a = d.allotment;
    const target = { _id: a._id, vehicleNo: a.vehicleNo, trackupNumber: a.trackupNumber, pifNumber: a.pifNumber, projectName: a.projectName };
    const done = () => { setAct(null); res.reload(); };
    if (act === "assign") return <AssignDriverModal target={target} onClose={() => setAct(null)} onDone={done} />;
    if (d.driver?.active)
      return (
        <ChangeDriverModal target={target} onClose={() => setAct(null)} onDone={done}
          current={{ driverId: d.driver.driverId, driverNumber: d.driver.driverNumber, driverName: d.driver.driverName, driverType: d.driver.driverType, mobileNumber: d.driver.mobileNumber, assignedAt: d.driver.assignedAt }} />
      );
  }
  return (
    <Modal title="Allotment Details" onClose={onClose} wide>
      {res.loading ? (
        <Skeleton rows={6} />
      ) : res.error || !res.data ? (
        <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} />
      ) : (
        <Body d={res.data} onAssign={() => setAct("assign")} onChangeDriver={() => setAct("change")} />
      )}
    </Modal>
  );
}

/** Every driver replacement of this allotment (newest first), with the reason, the Travel Amount Deduction and any attachment. */
export function DriverChanges({ events }: { events: AllotmentDetailData["events"] }) {
  const rows = events.filter((e) => e.action === "DRIVER_CHANGED");
  if (rows.length === 0) return null;
  return (
    <>
      <h4 className="sub">Driver changes</h4>
      <table className="table" data-section="driver-changes">
        <thead><tr><th>Changed</th><th>Previous Driver</th><th>Replacement Driver</th><th>Reason</th><th>Travel Amount Deduction</th><th>By</th><th>Attachments</th></tr></thead>
        <tbody>
          {rows.map((e) => {
            const x = (e.details ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
            const atts = (x.attachments ?? []) as { key: string; name: string; url?: string }[];
            return (
              <tr key={e._id}>
                <td>{fmtInstant(e.createdAt)}</td>
                <td>{[x.from?.driverNumber, x.from?.driverName].filter(Boolean).join(" · ") || "—"}</td>
                <td>{[x.to?.driverNumber, x.to?.driverName].filter(Boolean).join(" · ") || "—"}</td>
                <td>{x.reason}{x.remarks ? ` — ${x.remarks}` : ""}</td>
                <td data-deduction>{formatDeduction(Number(x.travelAmountDeduction ?? 0))}</td>
                <td>{who(e.username)}</td>
                <td>{atts.length === 0 ? "—" : atts.map((a) => <div key={a.key}>{a.name}</div>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function Body({ d, onAssign, onChangeDriver }: { d: AllotmentDetailData; onAssign?: () => void; onChangeDriver?: () => void }) {
  const a = d.allotment;
  return (
    <div className="allot-detail">
      <h4 className="sub">Project</h4>
      <dl className="kv">
        <KV k="Client / Billing Name" v={a.clientName} />
        <KV k="Project Name" v={a.projectName} />
        <KV k="Project Type" v={a.projectType === "ROADSHOW" ? "Roadshow" : "Signage"} />
        <KV k="Trackup Number" v={a.trackupNumber} />
        <KV k="PIF Number" v={a.pifNumber} />
        <KV k="Bill Number" v={a.billNumber} />
        <KV k="Project Period" v={projectPeriod(a.projectStart, a.projectEnd, formatDate)} />
      </dl>
      <h4 className="sub">Vehicles</h4>
      <dl className="kv">
        <KV k="Original Vehicle" v={vname(d.original)} />
        <KV k="Current Vehicle" v={vname(d.current)} />
        <KV k="This Allotment" v={<>{vname(a)} <AllotStatusBadge status={a.status} /></>} />
        <KV k="Vehicle Now" v={d.vehicle?.availabilityStatus ? d.vehicle.availabilityStatus.replace("_", " ") : null} />
      </dl>
      <AllotmentDriverSection d={d} onAssign={onAssign} onChange={onChangeDriver} />
      <h4 className="sub">Schedule (IST)</h4>
      <dl className="kv">
        <KV k="Allotted" v={fmtInstant(a.allottedAt)} />
        <KV k="Expected Release" v={fmtInstant(a.expectedReleaseAt)} />
        <KV k="Next Available" v={fmtInstant(a.nextAvailableAt)} />
        <KV k="Allotted By" v={who(a.createdBy)} />
        <KV k="Updated By" v={`${who(a.updatedBy)} · ${fmtInstant(a.updatedAt)}`} />
        <KV k="Remarks" v={a.remarks} />
        {a.releasedAt && <KV k="Released" v={`${fmtInstant(a.releasedAt)} · ${a.releaseReason ?? ""}`} />}
      </dl>

      <h4 className="sub">Vehicle changes</h4>
      {d.chain.filter((c) => c.previousAllotment).length === 0 ? (
        <p className="muted">The vehicle has not been changed.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Changed</th><th>From</th><th>To</th><th>Reason</th><th>By</th><th>Attachments</th></tr></thead>
          <tbody>
            {d.chain.filter((c) => c.previousAllotment).map((c) => (
              <tr key={c._id}>
                <td>{fmtInstant(c.changedAt)}</td>
                <td>{c.changedFromVehicleNo}</td>
                <td>{c.vehicleNo}</td>
                <td>{c.changeReason}{c.changeRemarks ? ` — ${c.changeRemarks}` : ""}</td>
                <td>{who(c.createdBy)}</td>
                <td>
                  {c.changeAttachments.length === 0 ? "—" : c.changeAttachments.map((x) => (
                    <div key={x.key}>{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="doc-file">📎 {x.name}</a> : x.name}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DriverChanges events={d.events} />

      <h4 className="sub">Activity timeline</h4>
      <ol className="al-timeline">
        {d.events.map((e) => (
          <li key={e._id}>
            <strong>{EVENT_LABEL[e.action] ?? e.action}</strong>
            <span>{eventText(e.action, e.details)}</span>
            <small className="muted">{who(e.username)} · {fmtInstant(e.createdAt)}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
