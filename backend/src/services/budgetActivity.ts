/* eslint-disable @typescript-eslint/no-explicit-any */
import { BudgetEvent } from "../models/Approval.js";
import { BudgetVersion } from "../models/Budget.js";
import { statusOf } from "./budgetEvents.js";

export interface Stamp {
  at: Date;
  by: string;
  version: number;
  /** True when a newer submission exists, so this decision is no longer the current state. */
  superseded?: boolean;
}

/**
 * Latest date/time of every kind of action, derived from the immutable history
 * (no duplicated fields). Missing entries mean the action never happened / is not recorded.
 */
export async function buildActivity(budget: {
  _id: unknown; createdAt?: Date; createdBy: string; approvalStatus?: string | null;
}) {
  const [events, latest] = await Promise.all([
    BudgetEvent.find({ budget: budget._id }).sort({ createdAt: 1, _id: 1 }).lean(),
    BudgetVersion.findOne({ budget: budget._id }).sort({ version: -1 }).lean(),
  ]);
  const idx = (a: string) => events.map((e: any) => e.action).lastIndexOf(a);
  const lastSubmitIdx = Math.max(idx("SUBMITTED"), idx("RESUBMITTED"));
  const stamp = (action: string): Stamp | null => {
    const i = idx(action);
    if (i < 0) return null;
    const e: any = events[i];
    const s: Stamp = { at: e.createdAt, by: e.username, version: e.version };
    if ((action === "APPROVED" || action === "REJECTED") && lastSubmitIdx > i) s.superseded = true;
    return s;
  };
  const v: any = latest;
  return {
    createdAt: budget.createdAt ?? null,
    createdBy: budget.createdBy,
    lastEdited: v ? ({ at: v.createdAt, by: v.updatedBy, version: v.version } as Stamp) : null,
    lastSubmitted: stamp("SUBMITTED"),
    lastResubmitted: stamp("RESUBMITTED"),
    lastApproved: stamp("APPROVED"),
    lastRejected: stamp("REJECTED"),
    currentStatus: statusOf(budget),
  };
}
