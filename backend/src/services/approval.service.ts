/* eslint-disable @typescript-eslint/no-explicit-any */
import { asVertical } from "../utils/vertical.js";
import { Budget, BudgetVersion } from "../models/Budget.js";
import { BudgetEvent } from "../models/Approval.js";
import { recordEvent, statusOf } from "./budgetEvents.js";
import { buildActivity } from "./budgetActivity.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { buildContext } from "./budget.service.js";
import { notifyRole, notifyUsername } from "./notification.service.js";
import { diffBudget, type BudgetInput } from "../validators/budget.validator.js";
import { AppError } from "../utils/AppError.js";

const validId = (id: string) => /^[a-f0-9]{24}$/i.test(id);
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ist = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d);

/** Fields RSOM may flag. v2 layout keys plus the legacy layout keys. */
export const REJECTABLE_FIELDS = [
  "mileage", "estimatedKmPerDay", "onRoadDate", "completionDate", "sundayHalt", "numberOfDays",
  "dieselAmount", "salaryAmount", "salaryUnit", "foodAmount", "foodUnit", "haltFood", "tolls", "others",
  "fromLocation", "toLocation", "totalKm", "fuelRate", "upDownValue", "otherDetails",
  "permitCharges", "tollCharges", "petrolAllowance", "foodAllowance", "accommodation", "iocCardPayment",
  "driverType", "driverSalary",
];

async function loadFull(budgetId: string) {
  if (!validId(budgetId)) throw new AppError("Invalid budget id", 400);
  const budget = await Budget.findById(budgetId).lean();
  if (!budget) throw new AppError("Budget not found", 404);
  const vehicle = await TrackingVehicle.findById(budget.vehicle).lean();
  const project = await TrackingProject.findById(budget.project).lean();
  if (!vehicle || !project) throw new AppError("Tracking record not found", 404);
  return { budget, vehicle, project, context: buildContext(project as any, vehicle as any) };
}

// ---------------------------------------------------------------- RBP: submit / resubmit
export async function submitBudget(budgetId: string, username: string, comment: unknown) {
  const { budget, vehicle, project } = await loadFull(budgetId);
  const note = typeof comment === "string" ? comment.trim().slice(0, 500) : "";
  const status = statusOf(budget);
  if (status === "PENDING") throw new AppError("Budget is already submitted and waiting for approval", 409);
  if (status === "APPROVED") throw new AppError("Budget is already approved", 409);

  const set = {
    approvalStatus: "PENDING",
    submittedVersion: budget.currentVersion,
    submittedBy: username,
    submittedAt: new Date(),
    resubmissionComment: note || undefined,
  };
  let resubmission = false;
  let updated;
  if (status === "REJECTED") {
    resubmission = true;
    // Must be a revised version: the rejected version itself can never be resubmitted unchanged.
    updated = await Budget.findOneAndUpdate(
      { _id: budgetId, approvalStatus: "REJECTED", currentVersion: budget.currentVersion, $expr: { $gt: ["$currentVersion", "$rejectedVersion"] } },
      { $set: set }, { new: true },
    ).lean();
    if (!updated) throw new AppError("Edit the rejected budget (new version) before resubmitting", 409);
  } else {
    updated = await Budget.findOneAndUpdate(
      { _id: budgetId, approvalStatus: { $in: [null, "DRAFT"] }, currentVersion: budget.currentVersion },
      { $set: set }, { new: true },
    ).lean();
    if (!updated) throw new AppError("Budget changed or was already submitted; reload and retry", 409);
  }

  const version = updated.currentVersion;
  let changes: unknown = null;
  const revision = resubmission ? await latestRevision(budgetId, budget.rejection?.version, version) : null;
  if (resubmission && budget.rejection?.version) {
    const prev: any = await BudgetVersion.findOne({ budget: budgetId, version: budget.rejection.version }).lean();
    const cur: any = await BudgetVersion.findOne({ budget: budgetId, version }).lean();
    if (prev && cur) changes = comparable(prev.data, cur.data);
  }
  await recordEvent(budgetId, version, resubmission ? "RESUBMITTED" : "SUBMITTED", username, "RBP", {
    comment: note || null, total: updated.total, ...(changes ? { changesSinceRejected: changes, rejectedVersion: budget.rejection.version } : {}),
    ...(revision ? { revisionReason: revision.reason, revisedBy: revision.by, revisedAt: revision.at } : {}),
  });

  await notifyRole("RSOM", {
    type: resubmission ? "BUDGET_RESUBMITTED" : "BUDGET_SUBMITTED",
    title: resubmission ? "Revised budget ready for review" : "A new budget is waiting for your approval",
    message:
      `${project.clientName} · ${vehicle.trackupNumber} · PIF ${vehicle.pifNumber} · ${project.projectType === "ROADSHOW" ? "Roadshow" : "Signage"} · ` +
      `${inr(updated.total)} · V${version} · submitted by ${username} on ${ist(updated.submittedAt as Date)}`,
    link: `/rsom/review?budget=${budgetId}`,
    meta: { budgetId, version, trackupNumber: vehicle.trackupNumber, total: updated.total },
    dedupeKey: `${resubmission ? "RESUB" : "SUB"}:${budgetId}:${version}`,
  });
  return updated;
}

/** A self-corrected version goes straight back to RSOM: history entry and notification. */
export async function announceSelfCorrection(updated: { _id: unknown; currentVersion: number; total: number }, username: string, reason: string) {
  const budgetId = String(updated._id);
  const version = updated.currentVersion;
  const { vehicle, project } = await loadFull(budgetId);
  const now = new Date();
  await recordEvent(budgetId, version, "RESUBMITTED", username, "RBP", { total: updated.total, revisionReason: reason, revisedBy: username, revisedAt: now });
  await notifyRole("RSOM", {
    type: "BUDGET_RESUBMITTED",
    title: "Revised budget ready for review",
    message: `${project.clientName} · ${vehicle.trackupNumber} · PIF ${vehicle.pifNumber} · ${inr(updated.total)} · V${version} · corrected by ${username} on ${ist(now)} · Reason: ${reason}`,
    link: `/rsom/review?budget=${budgetId}`,
    meta: { budgetId, version, trackupNumber: vehicle.trackupNumber, total: updated.total },
    dedupeKey: `RESUB:${budgetId}:${version}`,
  });
}

/** The newest edit reason given after the rejected version, with who edited and when. */
async function latestRevision(budgetId: string, after: number | undefined, upTo: number) {
  if (!after) return null;
  const v: any = await BudgetVersion.findOne({ budget: budgetId, version: { $gt: after, $lte: upTo }, revisionReason: { $exists: true } })
    .sort({ version: -1 }).lean();
  return v ? { reason: v.revisionReason as string, by: v.updatedBy as string, at: v.createdAt as Date, version: v.version as number } : null;
}

function comparable(prevData: any, nextData: any) {
  const strip = (d: any) => {
    const { computed: _c, schemaVersion: _s, ...rest } = d ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  };
  const next = strip(nextData) as BudgetInput;
  return diffBudget(strip(prevData), next);
}

// ---------------------------------------------------------------- RSOM: approve / reject
async function guardPending(budgetId: string, version: unknown) {
  const { budget, vehicle, project } = await loadFull(budgetId);
  if (statusOf(budget) !== "PENDING") throw new AppError(`Budget is not pending approval (status: ${statusOf(budget)})`, 409);
  if (!Number.isInteger(version) || version !== budget.currentVersion || version !== budget.submittedVersion)
    throw new AppError("This budget changed since you opened it; reload to review the current version", 409);
  return { budget, vehicle, project };
}

export async function approveBudget(budgetId: string, version: unknown, username: string) {
  const { budget, vehicle, project } = await guardPending(budgetId, version);
  const now = new Date();
  // Atomic: only one concurrent decision can move PENDING -> APPROVED for this exact version.
  const updated = await Budget.findOneAndUpdate(
    { _id: budgetId, approvalStatus: "PENDING", currentVersion: version, submittedVersion: version },
    { $set: { approvalStatus: "APPROVED", approvedVersion: version, reviewedBy: username, reviewedAt: now } },
    { new: true },
  ).lean();
  if (!updated) throw new AppError("This budget was already decided or changed; reload", 409);

  await recordEvent(budgetId, budget.currentVersion, "APPROVED", username, "RSOM", { total: budget.total });
  await notifyUsername(budget.createdBy, {
    type: "BUDGET_APPROVED",
    title: "Budget approved",
    message:
      `Your budget for ${vehicle.trackupNumber} (${vehicle.pifNumber}) has been approved by RSOM. Client: ${project.clientName} · ` +
      `Approved amount ${inr(budget.total)} · Version V${version} · ${ist(now)}`,
    link: `/rbp/budget?vehicle=${vehicle._id}`,
    meta: { budgetId, version, total: budget.total, trackupNumber: vehicle.trackupNumber },
    dedupeKey: `APPROVED:${budgetId}:${version}`,
  });
  return updated;
}

export interface RejectInput {
  version: unknown;
  reason: unknown;
  fields: unknown;
}

export function validateRejection(input: RejectInput) {
  const errors: string[] = [];
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  // The overall reason is optional for RSOM; the flagged fields and their comments stay mandatory.
  if (reason.length > 1000) errors.push("Rejection reason is too long");
  const fields: { field: string; comment: string }[] = [];
  const raw = Array.isArray(input.fields) ? input.fields : [];
  if (raw.length === 0) errors.push("Select at least one field that needs correction");
  const seen = new Set<string>();
  raw.forEach((f: any, i: number) => {
    const field = typeof f?.field === "string" ? f.field : "";
    const comment = typeof f?.comment === "string" ? f.comment.trim() : "";
    if (!REJECTABLE_FIELDS.includes(field)) return void errors.push(`Rejected field ${i + 1} is not a valid budget field`);
    if (seen.has(field)) return void errors.push(`Field "${field}" is selected more than once`);
    seen.add(field);
    if (!comment) return void errors.push(`Enter a comment for "${field}"`);
    if (comment.length > 500) return void errors.push(`Comment for "${field}" is too long`);
    fields.push({ field, comment });
  });
  return { errors, reason, fields };
}

export async function rejectBudget(budgetId: string, input: RejectInput, username: string) {
  const v = validateRejection(input);
  if (v.errors.length) throw new AppError(v.errors.join("; "), 400);
  const { budget, vehicle, project } = await guardPending(budgetId, input.version);
  const version = budget.currentVersion;
  const now = new Date();
  const rejection = { version, reason: v.reason || null, fields: v.fields, rejectedBy: username, rejectedAt: now };
  const updated = await Budget.findOneAndUpdate(
    { _id: budgetId, approvalStatus: "PENDING", currentVersion: version, submittedVersion: version },
    { $set: { approvalStatus: "REJECTED", rejectedVersion: version, reviewedBy: username, reviewedAt: now, rejection } },
    { new: true },
  ).lean();
  if (!updated) throw new AppError("This budget was already decided or changed; reload", 409);

  await recordEvent(budgetId, version, "REJECTED", username, "RSOM", { reason: v.reason || null, fields: v.fields, total: budget.total });
  await notifyUsername(budget.createdBy, {
    type: "BUDGET_REJECTED",
    title: "Budget rejected",
    message:
      `Your budget for ${vehicle.trackupNumber} (${vehicle.pifNumber}) has been rejected by RSOM. Please review the rejection details. ` +
      `Client: ${project.clientName} · Amount ${inr(budget.total)} · Fields: ${v.fields.map((f) => f.field).join(", ")} · ` +
      `${v.reason ? `Reason: ${v.reason} · ` : ""}Version V${version} · ${ist(now)}`,
    link: `/rbp/budget?vehicle=${vehicle._id}`,
    meta: { budgetId, version, total: budget.total, fields: v.fields, reason: v.reason || null, trackupNumber: vehicle.trackupNumber },
    dedupeKey: `REJECTED:${budgetId}:${version}`,
  });
  return updated;
}

// ---------------------------------------------------------------- queries
export interface ListQuery {
  status?: string; projectType?: string; client?: string; trackup?: string; pif?: string;
  from?: string; to?: string; page?: number; limit?: number;
}

const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/** Budgets that were submitted at least once (drafts are not visible to RSOM). */
export async function listApprovals(q: ListQuery) {
  const filter: any = { approvalStatus: { $in: ["PENDING", "APPROVED", "REJECTED"] } };
  if (q.status && ["PENDING", "APPROVED", "REJECTED"].includes(q.status)) filter.approvalStatus = q.status;
  if (q.from || q.to) {
    filter.submittedAt = {};
    if (q.from) filter.submittedAt.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (q.to) filter.submittedAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
  }
  const budgets = await Budget.find(filter).sort({ submittedAt: -1 }).lean();
  const vehicles = await TrackingVehicle.find({ _id: { $in: budgets.map((b) => b.vehicle) } }).lean();
  const projects = await TrackingProject.find({ _id: { $in: budgets.map((b) => b.project) } }).lean();
  const vMap = new Map(vehicles.map((v) => [String(v._id), v]));
  const pMap = new Map(projects.map((p) => [String(p._id), p]));

  let rows = budgets.map((b) => {
    const v: any = vMap.get(String(b.vehicle));
    const p: any = pMap.get(String(b.project));
    const d = p?.details ?? {};
    const roadshow = p?.projectType === "ROADSHOW";
    return {
      budgetId: String(b._id), budgetNumber: b.budgetNumber, status: statusOf(b),
      trackupNumber: v?.trackupNumber, pifNumber: v?.pifNumber, vehicleIndex: v?.vehicleIndex, vehicleType: v?.vehicleType ?? null,
      projectType: p?.projectType, client: p?.clientName,
      campaignFrom: roadshow ? d.startDate : d.fromDate, campaignTo: roadshow ? d.endDate : d.toDate,
      version: b.currentVersion, total: b.total, submittedBy: b.submittedBy, submittedAt: b.submittedAt,
    };
  });
  if (q.projectType) rows = rows.filter((r) => r.projectType === q.projectType);
  if (q.client) rows = rows.filter((r) => rx(q.client!).test(r.client ?? ""));
  if (q.trackup) rows = rows.filter((r) => rx(q.trackup!).test(r.trackupNumber ?? ""));
  if (q.pif) rows = rows.filter((r) => rx(q.pif!).test(r.pifNumber ?? ""));

  const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  return { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
}

export async function approvalStats(projectType?: string) {
  const type = asVertical(projectType);
  const only = type ? { project: { $in: await TrackingProject.find({ projectType: type }).distinct("_id") } } : {};
  const [pending, approved, rejected] = await Promise.all(
    ["PENDING", "APPROVED", "REJECTED"].map((s) => Budget.countDocuments({ approvalStatus: s, ...only })),
  );
  return { total: pending + approved + rejected, pending, approved, rejected };
}

/** Oldest first by default (existing contract); `desc` returns the latest action first. */
export async function listEvents(budgetId: string, desc = false) {
  if (!validId(budgetId)) throw new AppError("Invalid budget id", 400);
  if (!(await Budget.exists({ _id: budgetId }))) throw new AppError("Budget not found", 404);
  const dir = desc ? -1 : 1;
  return BudgetEvent.find({ budget: budgetId }).sort({ createdAt: dir, _id: dir }).lean();
}

export async function reviewDetail(budgetId: string, desc = false) {
  const { budget, vehicle, project, context } = await loadFull(budgetId);
  if (statusOf(budget) === "DRAFT") throw new AppError("This budget has not been submitted for approval", 404);
  const [versions, events] = await Promise.all([
    BudgetVersion.find({ budget: budgetId }).sort(desc ? { createdAt: -1, version: -1 } : { version: 1 }).lean(),
    listEvents(budgetId, desc),
  ]);
  // After a resubmission: rejected version vs the newly submitted version.
  let comparison: unknown = null;
  if (budget.rejection?.version && budget.currentVersion > budget.rejection.version) {
    const prev: any = versions.find((x: any) => x.version === budget.rejection.version);
    const cur: any = versions.find((x: any) => x.version === budget.currentVersion);
    if (prev && cur)
      comparison = {
        fromVersion: prev.version, toVersion: cur.version, changes: comparable(prev.data, cur.data),
        rejection: budget.rejection, resubmissionComment: budget.resubmissionComment ?? null,
        revision: await latestRevision(budgetId, prev.version, cur.version),
      };
  }
  // Pending self-correction (before any rejection): why RBP changed it and what changed.
  let selfCorrection: unknown = null;
  if (budget.selfRevisedVersion && budget.selfRevisedVersion === budget.currentVersion) {
    const prev: any = versions.find((x: any) => x.version === budget.currentVersion - 1);
    const cur: any = versions.find((x: any) => x.version === budget.currentVersion);
    if (prev && cur?.revisionReason)
      selfCorrection = { fromVersion: prev.version, toVersion: cur.version, changes: comparable(prev.data, cur.data), reason: cur.revisionReason, by: cur.updatedBy, at: cur.createdAt };
  }
  const activity = await buildActivity(budget);
  return { selfCorrection, context, projectDetails: project.details, vehicleId: String(vehicle._id), budget, versions, events, comparison, activity };
}
