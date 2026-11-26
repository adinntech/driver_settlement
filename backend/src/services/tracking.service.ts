import mongoose from "mongoose";
import { TrackingProject } from "../models/TrackingProject.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { validateTracking, type TrackingValidationOptions } from "../validators/tracking.validator.js";
import { allocateOne, type NumberStore } from "./numberAllocator.js";
import { Budget } from "../models/Budget.js";
import { AppError } from "../utils/AppError.js";

interface Actor {
  id: string;
  username: string;
}

const sameClient = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * One Project Code is one project of one project type. More tracking requests may be added to it later (they are grouped on
 * the dashboard), but only for the same client: a code already used by another client's project of the same type is rejected,
 * so vehicles of different clients can never end up in one project. Roadshow and Signage codes are independent.
 */
export async function assertProjectCodeFits(projectType: string, projectCode: string, clientName: string) {
  const clash = (owner: string) =>
    new AppError(`Project Code ${projectCode} is already used by the ${projectType === "ROADSHOW" ? "Roadshow" : "Signage"} project of ${owner}. Use that client's name to add vehicles to it, or enter a different Project Code.`, 409);
  // Requests saved before the claim below existed (or by older code paths) are checked directly.
  const used = await TrackingProject.find({ projectType, projectCode }).select("clientName").limit(50).lean();
  const other = used.find((p) => !sameClient(String(p.clientName), clientName));
  if (other) throw clash(String(other.clientName));
  // Atomic claim (unique _id per type + code): of two simultaneous requests by different clients only the first owns the code.
  const claims = mongoose.connection.collection<{ _id: string; client: string; clientName: string; at: Date }>("projectcodes");
  const key = `${projectType}:${projectCode}`;
  const norm = clientName.trim().replace(/\s+/g, " ").toLowerCase();
  for (let i = 0; i < 2; i++) {
    try {
      const c = await claims.findOneAndUpdate({ _id: key }, { $setOnInsert: { client: norm, clientName: clientName.trim(), at: new Date() } }, { upsert: true, returnDocument: "after" });
      if (c && c.client !== norm) throw clash(c.clientName);
      return;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // concurrent upsert of the same new key: read the winner
    }
  }
}

export async function createTracking(
  actor: Actor,
  body: { projectType?: unknown; details?: unknown; requestId?: unknown },
  opts: Pick<TrackingValidationOptions, "allowPastStart"> = {}, // internal callers only (dev seed); the API never passes it
) {
  const v = validateTracking(body.projectType, body.details, opts);
  if (v.errors.length) throw new AppError(v.errors.join("; "), 400);

  const requestId = typeof body.requestId === "string" && body.requestId ? body.requestId : undefined;
  if (requestId) {
    const existing = await TrackingProject.findOne({ requestId });
    if (existing) return loadProject(existing._id.toString()); // idempotent retry
  }
  await assertProjectCodeFits(String(body.projectType), v.projectCode, v.clientName);

  let project;
  try {
    project = await TrackingProject.create({
      projectType: body.projectType,
      clientName: v.clientName,
      projectCode: v.projectCode,
      vehicleCount: v.vehicleCount,
      details: v.details,
      createdBy: actor.id,
      createdByName: actor.username,
      requestId,
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000 && requestId) {
      const existing = await TrackingProject.findOne({ requestId });
      if (existing) return loadProject(existing._id.toString());
    }
    throw e;
  }
  const store: NumberStore = {
    exists: async (s) =>
      !!(await TrackingVehicle.exists({
        $or: [
          { trackupNumber: s.trackupNumber },
          { pifNumber: s.pifNumber },
          { displayNumber: s.displayNumber },
        ],
      })),
    insert: async (s, idx) => {
      await TrackingVehicle.create({ project: project._id, vehicleIndex: idx, ...s });
    },
  };

  try {
    for (let i = 1; i <= v.vehicleCount; i++) await allocateOne(store, i);
  } catch (e) {
    // No transactions on standalone MongoDB: compensate so no half-created project remains.
    await TrackingVehicle.deleteMany({ project: project._id });
    await TrackingProject.deleteOne({ _id: project._id });
    throw e;
  }
  return loadProject(project._id.toString());
}

export async function loadProject(id: string) {
  const project = await TrackingProject.findById(id).lean();
  if (!project) throw new AppError("Tracking request not found", 404);
  const vehicles = await TrackingVehicle.find({ project: id }).sort({ vehicleIndex: 1 }).lean();
  return { ...project, vehicles };
}

export interface ListFilters {
  q?: string;
  projectType?: string;
  from?: string;
  to?: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listTracking(f: ListFilters) {
  const pf: Record<string, unknown> = {};
  if (f.projectType === "ROADSHOW" || f.projectType === "SIGNAGE") pf.projectType = f.projectType;
  if (f.from || f.to) {
    const range: Record<string, Date> = {};
    if (f.from) range.$gte = new Date(`${f.from}T00:00:00+05:30`);
    if (f.to) range.$lte = new Date(`${f.to}T23:59:59.999+05:30`);
    pf.createdAt = range;
  }
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), "i");
    const vehicleHits = await TrackingVehicle.find({
      $or: [{ trackupNumber: rx }, { pifNumber: rx }, { displayNumber: rx }],
    }).distinct("project");
    pf.$or = [{ clientName: rx }, { projectCode: rx }, { _id: { $in: vehicleHits } }];
  }
  const projects = await TrackingProject.find(pf).sort({ createdAt: -1 }).lean();
  const vehicles = await TrackingVehicle.find({ project: { $in: projects.map((p) => p._id) } })
    .sort({ vehicleIndex: 1 })
    .lean();
  // Approval status per vehicle (null = no budget yet; budgets saved before approvals existed count as DRAFT).
  const budgets = await Budget.find({ vehicle: { $in: vehicles.map((v) => v._id) } })
    .select("vehicle approvalStatus")
    .lean();
  const approval = new Map(budgets.map((b) => [String(b.vehicle), b.approvalStatus ?? "DRAFT"]));
  return projects.map((p) => ({
    ...p,
    vehicles: vehicles
      .filter((x) => x.project.toString() === p._id.toString())
      .map((x) => ({ ...x, approvalStatus: approval.get(String(x._id)) ?? null })),
  }));
}

export async function trackingStats() {
  const [total, roadshow, signage, pending, created, recent] = await Promise.all([
    TrackingProject.countDocuments(),
    TrackingProject.countDocuments({ projectType: "ROADSHOW" }),
    TrackingProject.countDocuments({ projectType: "SIGNAGE" }),
    TrackingVehicle.countDocuments({ budgetStatus: "PENDING" }),
    TrackingVehicle.countDocuments({ budgetStatus: "CREATED" }),
    TrackingVehicle.find().sort({ createdAt: -1 }).limit(5).select("trackupNumber createdAt").lean(),
  ]);
  return { total, roadshow, signage, pendingBudget: pending, budgetCreated: created, recent };
}
