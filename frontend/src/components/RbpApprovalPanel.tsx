"use client";

import ReadMore from "@/components/ui/ReadMore";
import { ApprovalBadge } from "@/components/ApprovalTimeline";
import type { Budget } from "@/types/domain";
import { canSubmit, fieldLabel, statusOf } from "@/utils/budgetDescribe";
import { formatDateTime } from "@/utils/format";

/**
 * RBP view of the approval state: status and rejection details. Submitting (first time or after a rejection) is done from the
 * budget form itself with "Save & Submit for Approval", so this panel has no separate send action.
 */
export default function RbpApprovalPanel({ budget }: { budget: Budget; onChanged?: () => void }) {
  const status = statusOf(budget.approvalStatus);
  const ready = canSubmit(status, budget.currentVersion, budget.rejectedVersion);
  const rej = budget.rejection;

  return (
    <div className="card approval-panel">
      <div className="page-head tight">
        <div>
          <h3 className="sub">Approval status</h3>
          <ApprovalBadge status={status} />{" "}
          {status === "PENDING" && <span className="muted">V{budget.submittedVersion} submitted {formatDateTime(budget.submittedAt)} by {budget.submittedBy}</span>}
          {status === "APPROVED" && <span className="muted">V{budget.approvedVersion} approved by {budget.reviewedBy} on {formatDateTime(budget.reviewedAt)}</span>}
        </div>
      </div>
      {status === "DRAFT" && <p className="muted">Saved as a draft. Use Edit Budget, then Save &amp; Submit for Approval to send it to RSOM.</p>}
      {status === "REJECTED" && (
        <p className="muted">
          {ready
            ? "A revised version is saved. Use Edit Budget, then Save & Submit for Approval to resubmit it to RSOM."
            : "Edit the highlighted fields, then Save & Submit for Approval to resubmit."}
        </p>
      )}

      {status === "REJECTED" && rej && (
        <div className="rejection fade-in">
          <h4>Rejected by {rej.rejectedBy} · V{rej.version} · {formatDateTime(rej.rejectedAt)}</h4>
          {rej.reason && <p><ReadMore><strong>Reason:</strong> {rej.reason}</ReadMore></p>}
          <table className="table">
            <thead>
              <tr><th>Budget Field</th><th>Rejection Reason</th></tr>
            </thead>
            <tbody>
              {rej.fields.map((f) => (
                <tr key={f.field} className="rej-row">
                  <td><strong>{fieldLabel(f.field)}</strong></td>
                  <td><ReadMore>{f.comment}</ReadMore></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
