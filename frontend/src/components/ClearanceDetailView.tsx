"use client";

import TableWrap from "@/components/ui/TableWrap";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import { ClearanceHistory, ClearanceStatusBadge, DetailSections, FinancialPanel } from "@/components/Clearance";
import { RbpActions, ReviewActions } from "@/components/ClearanceActions";
import { PhotoThumb } from "@/components/DeliveryForm";
import { ErrorState, Skeleton } from "@/components/ui/Ui";
import { useApi } from "@/hooks/useApi";
import type { ClearanceDetail } from "@/utils/clearance";
import { DELIVERY_LABEL } from "@/utils/delivery";
import { formatDateTime } from "@/utils/format";

/** Shared detail page: RSA review (with Approve / Reject) or RBP view (with rejection details and resubmission). */
export default function ClearanceDetailPage({ mode }: { mode: "RSA" | "RBP" }) {
  return (
    <AppShell role={mode}>
      <Suspense fallback={<Skeleton rows={8} />}>
        <Screen mode={mode} />
      </Suspense>
    </AppShell>
  );
}

function Screen({ mode }: { mode: "RSA" | "RBP" }) {
  const id = useSearchParams().get("id");
  const base = mode === "RSA" ? "/rsa-clearances" : "/on-road-vehicles";
  const q = useApi<ClearanceDetail>(id ? `${base}/${id}` : null);
  const back = mode === "RSA" ? "/rsa/clearance" : "/rbp/on-road";
  if (!id) return <ErrorState message="No allocation selected." />;
  if (q.loading) return <Skeleton rows={8} />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? "Allocation not found"} onRetry={q.reload} />;
  const d = q.data;
  return (
    <>
      <div className="page-head">
        <div>
          <Link href={back} className="muted">← Back</Link>
          <h1>{mode === "RSA" ? "Review Vehicle & Driver" : "Vehicle Delivery Details"} · {d.trackupNumber} · {d.pifNumber}</h1>
          <p className="muted">Version V{d.version} · Submitted {formatDateTime(d.submittedAt)} by {d.submittedBy} <ClearanceStatusBadge status={d.status} /></p>
        </div>
      </div>
      {d.status === "APPROVED" && <div className="cl-flag ok" role="status">Approved by {d.reviewedBy} on {formatDateTime(d.reviewedAt)}</div>}
      {d.status === "YET_TO_APPROVE" && mode === "RBP" && <div className="cl-flag warn" role="status">Waiting for RSA Approval</div>}
      {d.status === "REJECTED" && d.rejection && (
        <div className="cl-flag bad" role="alert" data-section="rejection-details">
          Rejected by {d.rejection.rejectedBy} on {formatDateTime(d.rejection.rejectedAt)} — {d.rejection.reason}{d.rejection.remarks ? `: ${d.rejection.remarks}` : ""}
        </div>
      )}
      {d.changedSinceSubmission && d.status === "YET_TO_APPROVE" && <div className="cl-flag warn">The allocation changed since this page was prepared; reload to review the latest submission.</div>}
      <DetailSections d={d} />
      <FinancialPanel fin={d.financial} />
      {mode === "RBP" && <DeliverySection d={d} />}
      <ClearanceHistory rows={d.history} />
      {mode === "RBP" && d.deliveryHistory && d.deliveryHistory.length > 0 && <DeliveryHistory rows={d.deliveryHistory} />}
      {mode === "RSA" ? <ReviewActions d={d} onDone={q.reload} /> : <RbpActions d={d} onDone={q.reload} />}
    </>
  );
}

const DELIVERY_ACTION: Record<string, string> = {
  RSA_APPROVED: "RSA Clearance Approved", SPEEDOMETER_PHOTO_UPLOADED: "Speedometer Photo Uploaded", EVIDENCE_PHOTO_UPLOADED: "Driver & Vehicle Evidence Uploaded", ADDITIONAL_PHOTO_UPLOADED: "Additional Photo Uploaded", DELIVERED: "Vehicle Delivered",
};

/** RBP: RSA approval + delivery information. Delivered evidence is view-only (no edit / delete here). */
function DeliverySection({ d }: { d: ClearanceDetail }) {
  if (d.status !== "APPROVED") return null;
  return (
    <section className="card cl-section" data-section="delivery-information">
      <h3>Delivery Information</h3>
      <dl className="kv">
        <div><dt>RSA Approval Status</dt><dd>Approved</dd></div>
        <div><dt>Approved By</dt><dd>{d.approvedBy ?? "—"}</dd></div>
        <div><dt>Approval Date &amp; Time</dt><dd>{formatDateTime(d.approvedAt)}</dd></div>
        <div><dt>Delivery Status</dt><dd>{d.deliveryStatus ? DELIVERY_LABEL[d.deliveryStatus] : "—"}</dd></div>
        {d.delivery && (
          <>
            <div className="wide"><dt>Description</dt><dd>{d.delivery.description}</dd></div>
            <div><dt>Delivered By</dt><dd>{d.delivery.deliveredBy}</dd></div>
            <div><dt>Delivered Date &amp; Time</dt><dd>{formatDateTime(d.delivery.deliveredAt)}</dd></div>
          </>
        )}
      </dl>
      {d.delivery && (
        <div className="inline" style={{ alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
          <PhotoThumb photo={d.delivery.speedometerPhoto} label="Speedometer Photo" />
          <PhotoThumb photo={d.delivery.evidencePhoto} label="Driver & Vehicle Evidence Photo" />
          {(d.delivery.additionalPhotos ?? []).map((p, i) => <PhotoThumb key={p.key} photo={p} label={`Additional Photo ${i + 1}`} />)}
        </div>
      )}
      {d.canDeliver && (
        <div className="actions-row"><Link href={`/rbp/on-road/deliver?id=${d._id}`} className="btn btn-primary">Deliver Vehicle</Link></div>
      )}
    </section>
  );
}

function DeliveryHistory({ rows }: { rows: NonNullable<ClearanceDetail["deliveryHistory"]> }) {
  return (
    <section className="card cl-section" data-section="delivery-history">
      <h3>Vehicle Delivery History</h3>
      <TableWrap>
        <table className="table"><thead><tr><th>Version</th><th>Activity</th><th>User</th><th>Date &amp; Time</th></tr></thead>
          <tbody>{rows.map((h) => (<tr key={h._id}><td>V{h.version}</td><td>{DELIVERY_ACTION[h.action] ?? h.action}</td><td>{h.username} ({h.role})</td><td>{formatDateTime(h.at)}</td></tr>))}</tbody>
        </table>
      </TableWrap>
    </section>
  );
}
