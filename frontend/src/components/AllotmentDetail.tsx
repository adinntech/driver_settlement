"use client";

import { ErrorState, Modal, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import type { Allotment, AllotmentDetailData } from "@/types/domain";
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
  return EVENT_LABEL[action] ?? action;
}

export default function AllotmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const res = useApi<AllotmentDetailData>(`/vehicle-allotments/${id}`);
  return (
    <Modal title="Allotment Details" onClose={onClose} wide>
      {res.loading ? (
        <Skeleton rows={6} />
      ) : res.error || !res.data ? (
        <ErrorState message={res.error ?? "Not found"} onRetry={res.reload} />
      ) : (
        <Body d={res.data} />
      )}
    </Modal>
  );
}

export function Body({ d }: { d: AllotmentDetailData }) {
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
