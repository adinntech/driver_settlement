/* eslint-disable @typescript-eslint/no-explicit-any */
import { BudgetEvent } from "../models/Approval.js";
import { BudgetVersion } from "../models/Budget.js";
import { statusOf } from "./budgetEvents.js";
/**
 * Latest date/time of every kind of action, derived from the immutable history
 * (no duplicated fields). Missing entries mean the action never happened / is not recorded.
 */
export async function buildActivity(budget) {
    const [events, latest] = await Promise.all([
        BudgetEvent.find({ budget: budget._id }).sort({ createdAt: 1, _id: 1 }).lean(),
        BudgetVersion.findOne({ budget: budget._id }).sort({ version: -1 }).lean(),
    ]);
    const idx = (a) => events.map((e) => e.action).lastIndexOf(a);
    const lastSubmitIdx = Math.max(idx("SUBMITTED"), idx("RESUBMITTED"));
    const stamp = (action) => {
        const i = idx(action);
        if (i < 0)
            return null;
        const e = events[i];
        const s = { at: e.createdAt, by: e.username, version: e.version };
        if ((action === "APPROVED" || action === "REJECTED") && lastSubmitIdx > i)
            s.superseded = true;
        return s;
    };
    const v = latest;
    return {
        createdAt: budget.createdAt ?? null,
        createdBy: budget.createdBy,
        lastEdited: v ? { at: v.createdAt, by: v.updatedBy, version: v.version } : null,
        lastSubmitted: stamp("SUBMITTED"),
        lastResubmitted: stamp("RESUBMITTED"),
        lastApproved: stamp("APPROVED"),
        lastRejected: stamp("REJECTED"),
        currentStatus: statusOf(budget),
    };
}
