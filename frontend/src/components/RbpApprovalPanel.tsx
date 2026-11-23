"use client";

import { useRef, useState } from "react";
import { ApprovalBadge } from "@/components/ApprovalTimeline";
import { ConfirmDialog } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { request } from "@/services/api";
import type { Budget } from "@/types/domain";
import { canSubmit, fieldLabel, statusOf } from "@/utils/budgetDescribe";
import { formatDateTime } from "@/utils/format";

/** RBP view of the approval state: status, rejection details, submit/resubmit and history. */
export default function RbpApprovalPanel({ budget, onChanged }: { budget: Budget; onChanged: () => void }) {
  const toast = useToast();
  const status = statusOf(budget.approvalStatus);
  const [confirm, setConfirm] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inflight = useRef(false); // blocks double submit

  const resubmit = status === "REJECTED";
  const ready = canSubmit(status, budget.currentVersion, budget.rejectedVersion);
  const rej = budget.rejection;

  async function submit() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      await request(`/budgets/${budget._id}/submit`, "POST", { comment });
      toast(resubmit ? "Revised budget resubmitted to RSOM" : "Budget submitted to RSOM for approval");
      setConfirm(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="card approval-panel">
      <div className="page-head tight">
        <div>
          <h3 className="sub">Approval status</h3>
          <ApprovalBadge status={status} />{" "}
          {status === "PENDING" && <span className="muted">V{budget.submittedVersion} submitted {formatDateTime(budget.submittedAt)} by {budget.submittedBy}</span>}
          {status === "APPROVED" && <span className="muted">V{budget.approvedVersion} approved by {budget.reviewedBy} on {formatDateTime(budget.reviewedAt)}</span>}
        </div>
        {(status === "DRAFT" || status === "REJECTED") && (
          <button className="btn btn-primary" disabled={!ready} onClick={() => setConfirm(true)} title={ready ? "" : "Edit the rejected budget (new version) before resubmitting"}>
            {resubmit ? "Resubmit to RSOM" : "Submit for Approval"}
          </button>
        )}
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {status === "REJECTED" && !ready && <p className="muted">Edit the highlighted fields to create a new version, then resubmit.</p>}

      {status === "REJECTED" && rej && (
        <div className="rejection fade-in">
          <h4>Rejected by {rej.rejectedBy} · V{rej.version} · {formatDateTime(rej.rejectedAt)}</h4>
          <p><strong>Reason:</strong> {rej.reason}</p>
          <table className="table">
            <thead>
              <tr><th>Budget Field</th><th>Rejection Reason</th></tr>
            </thead>
            <tbody>
              {rej.fields.map((f) => (
                <tr key={f.field} className="rej-row">
                  <td><strong>{fieldLabel(f.field)}</strong></td>
                  <td>{f.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(status === "DRAFT" || status === "REJECTED") && (
        <label className="field comment-field">
          <span>{resubmit ? "Resubmission comment (optional)" : "Comment for RSOM (optional)"}</span>
          <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you change or what should RSOM know?" />
        </label>
      )}


      {confirm && (
        <ConfirmDialog
          title={resubmit ? "Resubmit revised budget?" : "Submit for approval?"}
          message={`Version V${budget.currentVersion} will be sent to RSOM. You cannot edit it while it is waiting for approval.`}
          confirmLabel={resubmit ? "Resubmit" : "Submit"}
          busy={busy}
          onConfirm={submit}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
