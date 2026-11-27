"use client";

import Link from "next/link";
import { DriverAvBadge } from "@/components/DriverAvailability";
import type { AllotmentDetailData, AllotmentRef } from "@/types/domain";
import { DRIVER_TYPE_TEXT, fmtInstant } from "@/utils/allotment";

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <dt>{k}</dt>
    <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
  </div>
);

/** Minimal driver cell for the allotment list: number, name and type, or "Driver not assigned". */
export function AllotmentDriverCell({ allotment }: { allotment: AllotmentRef | null }) {
  if (!allotment) return <span className="muted">—</span>;
  const d = allotment.driver;
  if (!d) return <span className="muted" data-driver="none">Driver not assigned</span>;
  return (
    <div className="av-cell" data-driver="assigned">
      <strong className="num">{d.driverNumber}</strong>
      <small>{d.driverName}</small>
      <small className="muted">{d.driverType ? DRIVER_TYPE_TEXT[d.driverType] ?? d.driverType : ""}</small>
    </div>
  );
}

/**
 * Driver Information block of the allotment detail. Actions only where they apply:
 * Assign Driver (active allotment without a driver), Change Driver (active allotment with a driver), View Driver Details (any driver on record).
 */
export function AllotmentDriverSection({ d, onAssign, onChange }: { d: AllotmentDetailData; onAssign?: () => void; onChange?: () => void }) {
  const dr = d.driver;
  const activeAllotment = d.allotment.status === "ACTIVE";
  return (
    <>
      <h4 className="sub">Driver Information</h4>
      {!dr ? (
        <p className="muted" data-driver="none">Driver Not Assigned</p>
      ) : (
        <dl className="kv" data-driver={dr.active ? "assigned" : "released"}>
          <KV k="Driver Number" v={<strong className="num">{dr.driverNumber}</strong>} />
          <KV k="Driver Name" v={dr.driverName} />
          <KV k="Driver Type" v={dr.driverType ? DRIVER_TYPE_TEXT[dr.driverType] ?? dr.driverType : null} />
          <KV k="Mobile Number" v={dr.mobileNumber} />
          <KV k="Driver Assigned" v={dr.assignedAt ? `${fmtInstant(dr.assignedAt)}${dr.assignedBy ? ` · ${dr.assignedBy}` : ""}` : null} />
          <KV k="Driver Status" v={dr.active ? <DriverAvBadge status={dr.status} /> : `Released ${fmtInstant(dr.releasedAt)}`} />
        </dl>
      )}
      <div className="inline row-actions" data-section="driver-actions">
        {activeAllotment && (!dr || !dr.active) && onAssign && <button type="button" className="btn btn-primary btn-sm" onClick={onAssign}>Assign Driver</button>}
        {activeAllotment && dr?.active && onChange && <button type="button" className="btn btn-outline btn-sm" onClick={onChange}>Change Driver</button>}
        {dr && <Link href={`/rbp/drivers/view?id=${dr.driverId}`} className="btn btn-ghost btn-sm">View Driver Details</Link>}
      </div>
    </>
  );
}
