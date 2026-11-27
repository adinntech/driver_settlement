"use client";

import type { BudgetEvent } from "@/types/domain";
import { STATUS_LABEL, type ApprovalStatus } from "@/utils/budgetDescribe";

export const ACTION_LABEL: Record<BudgetEvent["action"], string> = {
  CREATED: "Budget Created",
  UPDATED: "Budget Updated",
  SUBMITTED: "Submitted for Approval",
  RESUBMITTED: "Resubmitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const ApprovalBadge = ({ status }: { status: ApprovalStatus }) => (
  <span className={`badge badge-ap-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>
);
