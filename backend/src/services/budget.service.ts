/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomInt } from "node:crypto";
import { Budget, BudgetVersion } from "../models/Budget.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { budgetTotal, diffBudget, toStored, validateBudget } from "../validators/budget.validator.js";
import { recordEvent, statusOf } from "./budgetEvents.js";
import { buildActivity } from "./budgetActivity.js";
import { AppError } from "../utils/AppError.js";

const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
const validId = (id: string) => /^[a-f0-9]{24}$/i.test(id);

/** Read-only context shown on the budget form, taken from the original RSOP entry. */
export function buildContext(
  project: { projectType: string; clientName: string; details?: Record<string, any> },
  vehicle: { trackupNumber: string; pifNumber: string; displayNumber: string; vehicleIndex: number },
) {
  const d = project.details ?? {};
  const roadshow = project.projectType === "ROADSHOW";
  return {
    projectType: project.projectType,
    client: project.clientName,
    jobSheetNumber: roadshow ? null : (d.jobSheetNumber ?? null),
    paSystem: roadshow ? (d.paSystem ?? null) : null,
    sundayHalt: roadshow ? d.sundayHalt === "YES" : false,
    location: roadshow ? (d.reportingLocations ?? []).join(", ") : d.location,
    campaignFrom: roadshow ? d.startDate : d.fromDate,
    campaignTo: roadshow ? d.endDate : d.toDate,
    reportingDate: roadshow ? d.reportingDate : null, // Roadshow only
    numberOfDays: roadshow ? d.numberOfDays : d.totalDaysOfWork,
    trackupNumber: vehicle.trackupNumber,
    pifNumber: vehicle.pifNumber,
    displayNumber: vehicle.displayNumber,
    vehicleIndex: vehicle.vehicleIndex,
  };
}

async function contextFor(vehicleId: string) {
  if (!validId(vehicleId)) throw new AppError("Invalid vehicle id", 400);
  const vehicle = await TrackingVehicle.findById(vehicleId).lean();
  if (!vehicle) throw new AppError("Tracking vehicle not found", 404);
  const project = await TrackingProject.findById(vehicle.project).lean();
  if (!project) throw new AppError("Tracking request not found", 404);
  return { vehicle, project, context: buildContext(project, vehicle) };
}

export async function getVehicleBudget(vehicleId: string) {
  const { context } = await contextFor(vehicleId);
  const budget = await Budget.findOne({ vehicle: vehicleId }).lean();
  const activity = budget ? await buildActivity(budget) : null;
  return { context, budget, activity };
}

export async function createBudget(vehicleId: string, input: unknown, username: string) {
  const { vehicle, project, context } = await contextFor(vehicleId);
  const v = validateBudget(input);
  if (v.errors.length) throw new AppError(v.errors.join("; "), 400);
  const total = budgetTotal(v.data);

  for (let i = 0; i < 20; i++) {
    const budgetNumber = `BUD-${randomInt(100000, 999999)}`;
    try {
      const budget = await Budget.create({
        budgetNumber,
        vehicle: vehicle._id,
        project: project._id,
        data: toStored(v.data),
        total,
        currentVersion: 1,
        createdBy: username,
        updatedBy: username,
        approvalStatus: "DRAFT",
      });
      await BudgetVersion.create({
        budget: budget._id,
        version: 1,
        data: toStored(v.data),
        total,
        changes: [],
        updatedBy: username,
      });
      await TrackingVehicle.updateOne({ _id: vehicle._id }, { budgetStatus: "CREATED" });
      await recordEvent(budget._id, 1, "CREATED", username, "RBP", { total });
      return { context, budget: budget.toObject() };
    } catch (e) {
      if (!isDup(e)) throw e;
      // vehicle unique index => a budget already exists; otherwise budgetNumber collided, retry.
      if (await Budget.exists({ vehicle: vehicle._id }))
        throw new AppError("A budget already exists for this vehicle", 409);
    }
  }
  throw new AppError("Could not allocate a budget number", 500);
}

export async function updateBudget(budgetId: string, input: unknown, username: string) {
  if (!validId(budgetId)) throw new AppError("Invalid budget id", 400);
  const existing = await Budget.findById(budgetId);
  if (!existing) throw new AppError("Budget not found", 404);
  const st = statusOf(existing);
  if (st === "PENDING") throw new AppError("This budget is waiting for approval and cannot be edited", 409);
  if (st === "APPROVED") throw new AppError("An approved budget cannot be edited", 409);
  const v = validateBudget(input);
  if (v.errors.length) throw new AppError(v.errors.join("; "), 400);

  const changes = diffBudget(existing.data as Record<string, unknown>, v.data);
  if (changes.length === 0) throw new AppError("No changes to save", 400);

  const total = budgetTotal(v.data);
  const nextVersion = existing.currentVersion + 1;
  // Optimistic lock: only one concurrent editor can move from version N to N+1.
  const updated = await Budget.findOneAndUpdate(
    { _id: budgetId, currentVersion: existing.currentVersion, approvalStatus: { $nin: ["PENDING", "APPROVED"] } },
    { data: toStored(v.data), total, currentVersion: nextVersion, updatedBy: username },
    { new: true },
  );
  if (!updated) throw new AppError("Budget was modified by someone else; reload and retry", 409);
  await BudgetVersion.create({
    budget: budgetId,
    version: nextVersion,
    data: toStored(v.data),
    total,
    changes,
    updatedBy: username,
  });
  await recordEvent(budgetId, nextVersion, "UPDATED", username, "RBP", { total, changedFields: changes.map((c) => c.field) });
  return updated.toObject();
}

/** Oldest first by default (existing contract); `desc` returns the latest version first. */
export async function listVersions(budgetId: string, desc = false) {
  if (!validId(budgetId)) throw new AppError("Invalid budget id", 400);
  return BudgetVersion.find({ budget: budgetId }).sort(desc ? { createdAt: -1, version: -1 } : { version: 1 }).lean();
}

export async function getVersion(budgetId: string, version: number) {
  if (!validId(budgetId)) throw new AppError("Invalid budget id", 400);
  const v = await BudgetVersion.findOne({ budget: budgetId, version }).lean();
  if (!v) throw new AppError("Version not found", 404);
  return v;
}
