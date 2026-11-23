/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vehicle, VehicleHistory, VEHICLE_TYPES, DOC_SECTIONS } from "../models/Vehicle.js";
import {
  EXPIRING_DAYS, MAINTENANCE_DUE_DAYS, addDays, diffVehicle, docStatus, latestExpiry, todayYmd, validateVehicle,
  type Change, type DocStatus, type VehicleData,
} from "../validators/vehicle.validator.js";
import { normalizeVehicleNo } from "../utils/vehicleNo.js";
import { AppError } from "../utils/AppError.js";
import { attachmentUrl } from "./storage.service.js";
import { allocatability, validateAvailability, type AvailabilityData, type PrevAvailability } from "../validators/availability.validator.js";
import { syncAllotmentFromVehicle } from "./allotment.core.js";
import { allocationConflict, availabilityHistory, budgetReviewFlags, linkProject } from "./availability.service.js";

const validId = (id: string) => /^[a-f0-9]{24}$/i.test(id);
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FIELDS: (keyof VehicleData)[] = [
  "vehicleNo", "make", "model", "type", "yearOfManufacture", "purchaseDate", "currentRunning", "totalRunning",
  "stepneyStatus", "batteryStatus", "oilTopUpOn", "greasePackingOn", "generalCheckUpOn",
  "fc", "insurance", "rtoPermission", "policePermission", "permit", "condition", "specification",
];
const MAINT = ["oilTopUpOn", "greasePackingOn", "generalCheckUpOn"];
const DOC_ACTION: Record<string, any> = {
  fc: "FC_UPDATED", insurance: "INSURANCE_UPDATED", rtoPermission: "RTO_UPDATED", policePermission: "POLICE_UPDATED", permit: "PERMIT_UPDATED",
};

/** Adds the public URL of every attachment (computed on read, never stored). */
const withUrls = (v: any) => {
  const out = { ...v };
  for (const s of DOC_SECTIONS)
    out[s] = (v[s] ?? []).map((d: any) => (d.attachment ? { ...d, attachment: { ...d.attachment, url: attachmentUrl(d.attachment) } } : d));
  return out;
};

const withStatus = (v: any, now = new Date()) => ({
  ...withUrls(v),
  insuranceStatus: docStatus(v.insuranceExpiry, now),
  fcStatus: docStatus(v.fcExpiry, now),
  // Records without availability (created before this feature) report "not set"; a draft / inactive record is never allocatable.
  ...(() => {
    const a = allocatability(v.availability, now);
    const blocked = v.status !== "ACTIVE";
    return {
      allocatable: a.allocatable && !blocked,
      allocationNote: blocked && a.allocatable ? `Vehicle record is ${String(v.status).toLowerCase()}` : a.reason,
      releaseOverdue: a.releaseOverdue,
    };
  })(),
});

/** Adds the "budget no longer approved" review flag (the allocation itself is never changed silently). */
const withReview = (v: any, flags: Map<string, string>) => (flags.has(String(v._id)) ? { ...v, allocationReview: flags.get(String(v._id)) } : v);

const dupMessage = (e: unknown, vehicleNo: string | null) =>
  (e as { keyPattern?: Record<string, unknown> })?.keyPattern?.["availability.project.trackupNumber"]
    ? "This trackup number is already allocated to another vehicle"
    : `Vehicle number ${vehicleNo} already exists`;

/** Resolves the project link (read-only on RSOP data), then validates the availability block. */
async function checkAvailability(input: unknown, draft: boolean, prev?: PrevAvailability | null) {
  const linked = await linkProject(input);
  const r = validateAvailability(linked.input, draft, new Date(), prev);
  if (linked.error) r.errors.unshift(linked.error);
  return r;
}

/** Availability block as stored: the moment an issue was closed is kept. */
const storedAvailability = (data: AvailabilityData, prev: any) => ({
  ...data,
  ...(prev?.status === "ISSUE" && data.status !== "ISSUE" ? { issueResolvedAt: new Date() } : prev?.issueResolvedAt ? { issueResolvedAt: prev.issueResolvedAt } : {}),
});

const derived = (d: VehicleData) => ({ insuranceExpiry: latestExpiry(d.insurance), fcExpiry: latestExpiry(d.fc) });

async function duplicateCheck(vehicleNo: string | null, exceptId?: string) {
  if (!vehicleNo) return;
  const clash = await Vehicle.findOne({ vehicleNo, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select("_id status").lean();
  if (clash) throw new AppError(`Vehicle number ${vehicleNo} already exists`, 409);
}

type SaveAs = "DRAFT" | "FINAL";
const parseSaveAs = (v: unknown): SaveAs => (v === "DRAFT" ? "DRAFT" : "FINAL");

export async function createVehicle(input: any, username: string) {
  const saveAs = parseSaveAs(input?.saveAs);
  const v = validateVehicle(input, saveAs === "DRAFT");
  const av = await checkAvailability(input?.availability, saveAs === "DRAFT");
  const errors = [...v.errors, ...av.errors];
  if (errors.length) throw new AppError(errors.join("; "), 400);
  await duplicateCheck(v.data.vehicleNo);
  const clash = av.data?.status === "IN_USE" ? await allocationConflict(av.data.project?.trackupNumber) : null;
  if (clash) throw new AppError(clash, 409);
  let doc;
  try {
    doc = await Vehicle.create({
      ...v.data, ...derived(v.data), ...(av.data ? { availability: storedAvailability(av.data, undefined) } : {}),
      status: saveAs === "DRAFT" ? "DRAFT" : "ACTIVE", createdBy: username, updatedBy: username,
    });
  } catch (e) {
    if (isDup(e)) throw new AppError(dupMessage(e, v.data.vehicleNo), 409);
    throw e;
  }
  const empty = Object.fromEntries(FIELDS.map((k) => [k, null]));
  await VehicleHistory.create({
    vehicle: doc._id, action: saveAs === "DRAFT" ? "DRAFT_SAVED" : "CREATED", username,
    changes: diffVehicle(empty, v.data as any, FIELDS as string[]),
  });
  if (av.data) {
    const rows = availabilityHistory(undefined, av.data);
    if (rows.length) await VehicleHistory.insertMany(rows.map((r) => ({ ...r, vehicle: doc._id, username })));
    await syncAllotmentFromVehicle(doc.toObject(), undefined, username);
  }
  return withStatus(doc.toObject());
}

export async function updateVehicle(id: string, input: any, username: string) {
  if (!validId(id)) throw new AppError("Invalid vehicle id", 400);
  const existing: any = await Vehicle.findById(id).lean();
  if (!existing) throw new AppError("Vehicle not found", 404);
  const saveAs = parseSaveAs(input?.saveAs);
  const isDraft = existing.status === "DRAFT";
  if (saveAs === "DRAFT" && !isDraft) throw new AppError("An active vehicle cannot be saved back as a draft", 400);

  const v = validateVehicle(input, saveAs === "DRAFT");
  const av = await checkAvailability(input?.availability, saveAs === "DRAFT", existing.availability);
  const errors = [...v.errors, ...av.errors];
  if (errors.length) throw new AppError(errors.join("; "), 400);
  await duplicateCheck(v.data.vehicleNo, id);
  const prevAv = existing.availability;
  if (av.data?.status === "IN_USE" && prevAv?.status === "ISSUE")
    throw new AppError("This vehicle has an open issue; mark it Available Now once it is resolved before allocating it to a project", 409);
  if (av.data?.status === "IN_USE" && prevAv?.status === "IN_USE" && prevAv.project?.trackupNumber && av.data.project?.trackupNumber
    && prevAv.project.trackupNumber !== av.data.project.trackupNumber)
    throw new AppError(`Vehicle is already allocated to trackup ${prevAv.project.trackupNumber}; release it (Available Now) before allocating another project`, 409);
  const avRows = av.data ? availabilityHistory(existing.availability, av.data) : [];
  const clash = av.data?.status === "IN_USE" && avRows.length ? await allocationConflict(av.data.project?.trackupNumber, id) : null;
  if (clash) throw new AppError(clash, 409);

  let nextStatus = existing.status as string;
  const converting = isDraft && saveAs === "FINAL";
  if (converting) nextStatus = "ACTIVE";
  else if (!isDraft && input?.status !== undefined) {
    if (input.status !== "ACTIVE" && input.status !== "INACTIVE") throw new AppError("Status must be ACTIVE or INACTIVE", 400);
    nextStatus = input.status;
  }

  const changes = diffVehicle(existing, v.data as any, FIELDS as string[]);
  const statusChanged = nextStatus !== existing.status;
  if (!changes.length && !statusChanged && !avRows.length) throw new AppError("No changes to save", 400);

  // Optimistic lock on the revision: two concurrent saves cannot both win.
  let updated: any;
  try {
    updated = await Vehicle.findOneAndUpdate(
      { _id: id, revision: existing.revision },
      {
        $set: {
          ...v.data, ...derived(v.data), status: nextStatus, updatedBy: username,
          ...(av.data && avRows.length ? { availability: storedAvailability(av.data, existing.availability) } : {}),
        },
        $inc: { revision: 1 },
      },
      { new: true },
    ).lean();
  } catch (e) {
    if (isDup(e)) throw new AppError(dupMessage(e, v.data.vehicleNo), 409);
    throw e;
  }
  if (!updated) throw new AppError("This vehicle was changed by someone else; reload and try again", 409);

  const rows: { vehicle: unknown; action: string; changes: Change[]; username: string }[] = [];
  const add = (action: string, ch: Change[]) => ch.length && rows.push({ vehicle: id, action, changes: ch, username });
  if (saveAs === "DRAFT") add("DRAFT_SAVED", changes);
  else {
    if (converting) rows.push({ vehicle: id, action: "DRAFT_CONVERTED", changes: [{ field: "status", from: "DRAFT", to: "ACTIVE" }], username });
    add("UPDATED", changes.filter((c) => !MAINT.includes(c.field) && !(c.field in DOC_ACTION)));
    for (const s of DOC_SECTIONS) add(DOC_ACTION[s], changes.filter((c) => c.field === s));
    add("MAINTENANCE_UPDATED", changes.filter((c) => MAINT.includes(c.field)));
    if (statusChanged && !converting) rows.push({ vehicle: id, action: "STATUS_CHANGED", changes: [{ field: "status", from: existing.status, to: nextStatus }], username });
  }
  if (rows.length) await VehicleHistory.insertMany(rows);
  if (avRows.length) {
    await VehicleHistory.insertMany(avRows.map((r) => ({ ...r, vehicle: id, username })));
    await syncAllotmentFromVehicle(updated, existing.availability, username);
  }
  return withStatus(updated);
}

export async function deleteDraft(id: string, username: string) {
  if (!validId(id)) throw new AppError("Invalid vehicle id", 400);
  const v: any = await Vehicle.findById(id).lean();
  if (!v) throw new AppError("Vehicle not found", 404);
  if (v.status !== "DRAFT") throw new AppError("Only draft vehicles can be deleted", 409);
  const r = await Vehicle.deleteOne({ _id: id, status: "DRAFT" });
  if (!r.deletedCount) throw new AppError("Only draft vehicles can be deleted", 409);
  await VehicleHistory.create({ vehicle: id, action: "DRAFT_DELETED", username, changes: [{ field: "vehicleNo", from: v.vehicleNo ?? null, to: null }] });
  return { deleted: true };
}

export async function getVehicle(id: string) {
  if (!validId(id)) throw new AppError("Invalid vehicle id", 400);
  const v = await Vehicle.findById(id).lean();
  if (!v) throw new AppError("Vehicle not found", 404);
  return withReview(withStatus(v), await budgetReviewFlags([v]));
}

/** Latest first by default. */
export async function vehicleHistory(id: string, asc = false) {
  if (!validId(id)) throw new AppError("Invalid vehicle id", 400);
  const dir = asc ? 1 : -1;
  return VehicleHistory.find({ vehicle: id }).sort({ createdAt: dir, _id: dir }).lean();
}

export interface ListQuery {
  q?: string; type?: string; make?: string; model?: string; year?: number; insuranceStatus?: string; fcStatus?: string;
  batteryStatus?: string; stepneyStatus?: string; status?: string; from?: string; to?: string; page?: number; limit?: number;
  docStatus?: string; docType?: string; availabilityStatus?: string; projectType?: string; clientName?: string; vehicleNo?: string; nextAvailableFrom?: string; nextAvailableTo?: string;
}

function expiryFilter(field: string, s: string, now: Date) {
  const today = todayYmd(now);
  const soon = addDays(today, EXPIRING_DAYS);
  if (s === "NONE") return { $or: [{ [field]: null }, { [field]: { $exists: false } }] };
  if (s === "EXPIRED") return { [field]: { $lt: today } };
  if (s === "EXPIRING_SOON") return { [field]: { $gte: today, $lte: soon } };
  if (s === "VALID") return { [field]: { $gt: soon } };
  return null;
}

export function buildFilter(q: ListQuery, now = new Date()) {
  const and: any[] = [];
  const ci = (v: string) => new RegExp(`^${esc(v.trim())}$`, "i");
  if (q.q?.trim()) {
    const raw = q.q.trim();
    const rx = new RegExp(esc(raw), "i");
    const compact = new RegExp(esc(raw.replace(/[ -]/g, "").toUpperCase()), "i"); // "tn 58" still finds TN58BM6554
    and.push({
      $or: [
        { vehicleNo: compact }, { make: rx }, { model: rx }, { type: rx },
        { "fc.attachment.name": rx }, { "insurance.attachment.name": rx }, { "rtoPermission.attachment.name": rx },
        { "policePermission.attachment.name": rx }, { "permit.attachment.name": rx },
        { "availability.project.projectName": rx }, { "availability.project.clientName": rx },
        { "availability.project.trackupNumber": rx }, { "availability.project.pifNumber": rx },
      ],
    });
  }
  if (q.availabilityStatus && ["AVAILABLE", "IN_USE", "ISSUE"].includes(q.availabilityStatus)) and.push({ "availability.status": q.availabilityStatus });
  if (q.projectType && ["ROADSHOW", "SIGNAGE"].includes(q.projectType)) and.push({ "availability.project.projectType": q.projectType });
  if (q.clientName?.trim()) and.push({ "availability.project.clientName": new RegExp(esc(q.clientName.trim()), "i") });
  if (q.vehicleNo?.trim()) and.push({ vehicleNo: new RegExp(esc(q.vehicleNo.trim().replace(/[ -]/g, "").toUpperCase()), "i") });
  if (q.nextAvailableFrom || q.nextAvailableTo) {
    const r: any = {};
    if (q.nextAvailableFrom) r.$gte = `${q.nextAvailableFrom}T00:00`;
    if (q.nextAvailableTo) r.$lte = `${q.nextAvailableTo}T23:59`;
    and.push({ "availability.status": { $in: ["IN_USE", "ISSUE"] }, "availability.nextAvailableAt": r });
  }
  if (q.type) and.push({ type: q.type });
  if (q.make) and.push({ make: ci(q.make) });
  if (q.model) and.push({ model: ci(q.model) });
  if (q.year) and.push({ yearOfManufacture: q.year });
  if (q.batteryStatus) and.push({ batteryStatus: ci(q.batteryStatus) });
  if (q.stepneyStatus) and.push({ stepneyStatus: ci(q.stepneyStatus) });
  if (q.status && ["DRAFT", "ACTIVE", "INACTIVE"].includes(q.status)) and.push({ status: q.status });
  // one consolidated FC / Insurance filter: each document is evaluated on its own expiry date
  if (q.docStatus && ["VALID", "EXPIRING_SOON", "EXPIRED", "NONE"].includes(q.docStatus)) {
    const fc = expiryFilter("fcExpiry", q.docStatus, now);
    const ins = expiryFilter("insuranceExpiry", q.docStatus, now);
    if (q.docType === "FC") and.push(fc);
    else if (q.docType === "INSURANCE") and.push(ins);
    else and.push({ $or: [fc, ins] });
  }
  if (q.insuranceStatus) { const f = expiryFilter("insuranceExpiry", q.insuranceStatus, now); if (f) and.push(f); }
  if (q.fcStatus) { const f = expiryFilter("fcExpiry", q.fcStatus, now); if (f) and.push(f); }
  if (q.from || q.to) {
    const r: any = {};
    if (q.from) r.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (q.to) r.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
    and.push({ createdAt: r });
  }
  return and.length ? { $and: and } : {};
}

export async function listVehicles(q: ListQuery) {
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const filter = buildFilter(q);
  const [items, total] = await Promise.all([
    Vehicle.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Vehicle.countDocuments(filter),
  ]);
  const now = new Date();
  const flags = await budgetReviewFlags(items);
  return { items: items.map((v) => withReview(withStatus(v, now), flags)), total, page, limit };
}

export async function vehicleSummary(now = new Date()) {
  const today = todayYmd(now);
  const soon = addDays(today, EXPIRING_DAYS);
  const cutoff = addDays(today, -MAINTENANCE_DUE_DAYS);
  const [total, active, draft, maintenance, expiring, availableNow, inUse, withIssue] = await Promise.all([
    Vehicle.countDocuments(),
    Vehicle.countDocuments({ status: "ACTIVE" }),
    Vehicle.countDocuments({ status: "DRAFT" }),
    // maintenance recorded but last done more than MAINTENANCE_DUE_DAYS ago
    Vehicle.countDocuments({ status: "ACTIVE", $or: MAINT.map((f) => ({ [f]: { $lt: cutoff, $type: "string" } })) }),
    Vehicle.countDocuments({ status: "ACTIVE", $or: [{ insuranceExpiry: { $lte: soon, $type: "string" } }, { fcExpiry: { $lte: soon, $type: "string" } }] }),
    Vehicle.countDocuments({ status: "ACTIVE", "availability.status": "AVAILABLE" }),
    Vehicle.countDocuments({ status: "ACTIVE", "availability.status": "IN_USE" }),
    Vehicle.countDocuments({ status: "ACTIVE", "availability.status": "ISSUE" }),
  ]);
  return { total, active, draft, maintenanceDue: maintenance, expiringSoon: expiring, availableNow, inUse, withIssue, rules: { expiringDays: EXPIRING_DAYS, maintenanceDueDays: MAINTENANCE_DUE_DAYS } };
}

/** Distinct values that feed the filter dropdowns. */
export async function vehicleFilterOptions() {
  const d = (f: string) => Vehicle.distinct(f, { [f]: { $nin: [null, ""] } });
  const [make, model, year, battery, stepney] = await Promise.all([d("make"), d("model"), d("yearOfManufacture"), d("batteryStatus"), d("stepneyStatus")]);
  const sortS = (a: string[]) => [...a].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }));
  return {
    types: VEHICLE_TYPES, makes: sortS(make), models: sortS(model), years: [...year].sort((a: number, b: number) => b - a),
    batteryStatuses: sortS(battery), stepneyStatuses: sortS(stepney),
  };
}

export { normalizeVehicleNo };
export type { DocStatus };
