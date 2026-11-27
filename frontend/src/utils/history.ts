import type { BudgetEvent, BudgetVersion } from "@/types/domain";
import type { ApprovalStatus } from "./budgetDescribe";

const time = (iso: string | undefined | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Latest first, by the real creation timestamp; version number only breaks ties. */
export const sortVersionsDesc = (versions: BudgetVersion[]): BudgetVersion[] =>
  [...versions].sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.version - a.version);

/** Latest action first, by the real action timestamp; id (creation order) only breaks ties. */
export const sortEventsDesc = (events: BudgetEvent[]): BudgetEvent[] =>
  [...events].sort((a, b) => time(b.createdAt) - time(a.createdAt) || (a._id < b._id ? 1 : a._id > b._id ? -1 : 0));

export const APPROVAL_ACTIONS: BudgetEvent["action"][] = ["SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED"];

/** Approval history = submit / resubmit / approve / reject actions only (edits live in the version history). */
export const approvalEvents = (events: BudgetEvent[]): BudgetEvent[] =>
  sortEventsDesc(events.filter((e) => APPROVAL_ACTIONS.includes(e.action)));

export const statusAfter = (action: BudgetEvent["action"]): ApprovalStatus =>
  action === "APPROVED" ? "APPROVED" : action === "REJECTED" ? "REJECTED" : action === "SUBMITTED" || action === "RESUBMITTED" ? "PENDING" : "DRAFT";

/**
 * Status of one budget version, from the recorded history.
 * null = nothing was recorded for this version (older data): shown as "Not available", never guessed.
 */
export function versionStatus(version: number, events: BudgetEvent[]): ApprovalStatus | null {
  const mine = sortEventsDesc(events.filter((e) => e.version === version));
  return mine.length ? statusAfter(mine[0].action) : null;
}

/** When this version was last submitted / resubmitted for approval (null if it never was). */
export function versionSubmittedAt(version: number, events: BudgetEvent[]): string | null {
  const s = sortEventsDesc(events.filter((e) => e.version === version && (e.action === "SUBMITTED" || e.action === "RESUBMITTED")));
  return s.length ? s[0].createdAt : null;
}
