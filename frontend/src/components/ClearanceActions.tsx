"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { ApiError, request, uploadAttachment } from "@/services/api";
import type { Attachment } from "@/types/domain";
import { REJECTION_REASONS, MAX_REMARKS, financialLabel, outstandingText, validateRejection, type ClearanceDetail } from "@/utils/clearance";
import { formatInr } from "@/utils/format";

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");

/** RSA: Approve / Reject bar at the bottom of the review page. Approval is disabled (with the reason) while the advance blocks it. */
export function ReviewActions({ d, onDone }: { d: ClearanceDetail; onDone: () => void }) {
  const [dlg, setDlg] = useState<"approve" | "reject" | null>(null);
  const pending = d.status === "YET_TO_APPROVE";
  return (
    <>
      <div className="cl-actions" data-section="review-actions">
        {!pending && <span className="muted">This allocation is already {d.status === "APPROVED" ? "approved" : "rejected"}.</span>}
        {pending && !d.canApprove && d.approveBlockedReason && <span className="text-danger" role="alert">Approval disabled: {d.approveBlockedReason}</span>}
        <button type="button" className="btn btn-primary" disabled={!d.canApprove} onClick={() => setDlg("approve")}>Approve Vehicle &amp; Driver</button>
        <button type="button" className="btn btn-outline btn-danger" disabled={!pending} onClick={() => setDlg("reject")}>Reject Vehicle &amp; Driver</button>
      </div>
      {dlg === "approve" && <ApproveDialog d={d} onClose={() => setDlg(null)} onDone={onDone} />}
      {dlg === "reject" && <RejectDialog d={d} onClose={() => setDlg(null)} onDone={onDone} />}
    </>
  );
}

function ApproveDialog({ d, onClose, onDone }: { d: ClearanceDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await request(`/rsa-clearances/${d._id}/approve`, "POST", { version: d.version });
      toast("Vehicle and driver approved");
      onDone();
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Modal title="Approve Vehicle & Driver" onClose={onClose}>
      <dl className="kv compact">
        <div><dt>Trackup Number</dt><dd>{d.trackupNumber}</dd></div>
        <div><dt>Vehicle Number</dt><dd>{d.vehicleNo}</dd></div>
        <div><dt>Driver</dt><dd>{d.driverNumber} · {d.driverName}</dd></div>
        <div><dt>Advance Verification</dt><dd>{financialLabel(d.financial.status)} ({outstandingText(d.financial.outstanding, d.financial.status)})</dd></div>
      </dl>
      <p className="muted">Approve this complete vehicle and driver allocation for on-road operations?</p>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? "Please wait…" : "Confirm Approval"}</button>
      </div>
    </Modal>
  );
}

function RejectDialog({ d, onClose, onDone }: { d: ClearanceDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<string>(d.financial.status === "OUTSTANDING" ? "Outstanding Driver Advance" : "");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = validateRejection(reason, remarks);
  async function go() {
    if (problems.length) return setError(problems.join("; "));
    setBusy(true);
    setError(null);
    try {
      const attachments: Attachment[] = file ? [await uploadAttachment(file)] : [];
      await request(`/rsa-clearances/${d._id}/reject`, "POST", { version: d.version, reason, remarks: remarks.trim() || undefined, attachments });
      toast("Vehicle and driver rejected");
      onDone();
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Modal title="Reject Vehicle & Driver" onClose={onClose}>
      <p className="muted">{d.trackupNumber} · {d.vehicleNo} · {d.driverNumber} {d.driverName} · Outstanding advance: {outstandingText(d.financial.outstanding, d.financial.status)}</p>
      <label className="field"><span>Rejection Reason *</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Rejection reason">
          <option value="">Select a reason</option>{REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label className="field"><span>Additional Remarks{reason === "Other" ? " *" : " (optional)"}</span>
        <textarea value={remarks} maxLength={MAX_REMARKS} rows={3} onChange={(e) => setRemarks(e.target.value)} aria-label="Additional remarks" />
      </label>
      <label className="field"><span>Supporting Attachment (optional)</span>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Supporting attachment" />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={go} disabled={busy || problems.length > 0}>{busy ? "Please wait…" : "Confirm Rejection"}</button>
      </div>
    </Modal>
  );
}

/** RBP: view the rejection, jump to the existing change driver / vehicle screens, then resubmit as a new version. */
export function RbpActions({ d, onDone }: { d: ClearanceDetail; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (d.status !== "REJECTED") return null;
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await request(`/on-road-vehicles/${d._id}/resubmit`, "POST", {});
      toast("Allocation resubmitted for RSA approval");
      setConfirm(false);
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card cl-section" data-section="corrective-actions">
      <h3>Corrective Actions</h3>
      <p className="muted">Change the driver or vehicle in Vehicle Management → Allotment if needed, then resubmit. The rejected version stays in the history.</p>
      {d.changedSinceSubmission && d.current && <div className="cl-flag warn">The allocation was changed after the rejection: now {d.current.vehicleNo} · {d.current.driverNumber} {d.current.driverName}.</div>}
      {!d.allocationActive && <div className="cl-flag bad" role="alert">No active vehicle and driver allocation exists; allot a vehicle and driver before resubmitting.</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="actions-row">
        <a className="btn btn-outline" href="/rbp/vehicles/allotment">Change Driver / Vehicle</a>
        <button className="btn btn-primary" disabled={!d.canResubmit} onClick={() => setConfirm(true)}>Resubmit for RSA Approval</button>
      </div>
      {confirm && (
        <Modal title="Resubmit for RSA Approval" onClose={() => setConfirm(false)}>
          <p className="muted">Resubmit {d.trackupNumber} with the vehicle and driver currently allotted. A new version is created and RSA is notified. Approved budget: {formatInr(d.project.approvedBudgetAmount)}.</p>
          <div className="actions-row">
            <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? "Please wait…" : "Confirm Resubmission"}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
