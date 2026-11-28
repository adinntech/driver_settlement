/* eslint-disable @typescript-eslint/no-explicit-any */
import { countedHistorical } from "../models/HistoricalSuspense.js";
import { asVertical } from "../utils/vertical.js";
import mongoose from "mongoose";
import { Budget, BudgetVersion } from "../models/Budget.js";
import { BudgetEvent } from "../models/Approval.js";
import { Clearance, ClearanceEvent, REJECTION_REASONS, type ClearanceAction, type ClearanceStatus } from "../models/Clearance.js";
import { Driver } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { AllotmentEvent, VehicleAllotment } from "../models/VehicleAllotment.js";
import { Vehicle, DOC_SECTIONS } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { verifyAdvances, type AdvanceVerification, type SettlementTxn } from "../utils/advanceVerification.js";
import { maskAccount } from "../validators/driverBank.validator.js";
import { parseAttachments } from "../validators/allotment.validator.js";
import { attachmentUrl } from "./storage.service.js";
import { notifyRole, notifyUsername } from "./notification.service.js";

/**
 * RSA Vehicle & Driver Clearance. Read-only on every existing record (tracking, budgets, allotments, vehicles, drivers, advances);
 * it only writes its own Clearance row and the immutable ClearanceEvent trail. The standalone MongoDB has no multi-document
 * transactions, so every state change is one atomic conditional update (status + version guard) followed by its history row.
 */

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
const oid = (id: unknown) => new mongoose.Types.ObjectId(String(id));
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ist = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d);
const inr = (n: number | null) => (n === null ? "Not Available" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const rsaLink = (id: unknown) => `/rsa/clearance/review?id=${id}`;
export const rbpLink = (id: unknown) => `/rbp/on-road/view?id=${id}`;

// ---------------------------------------------------------------- driver advance verification

/**
 * The system keeps no repayment / settlement records for driver advances (advances are immutable single rows), so there is no
 * settlement source to read. Returning null makes every driver that HAS an advance "Verification Data Unavailable" instead of
 * silently assuming zero. When a settlement store is added, return its rows here and the calculation needs no other change.
 */
export const settlementSource: { load: (driverId: unknown) => Promise<SettlementTxn[] | null> } = {
  load: async () => null, // replaceable seam: tests (and a future settlement store) plug in here
};

async function advanceRows(driverId: unknown): Promise<[any[], SettlementTxn[] | null]> {
  return Promise.all([DriverAdvance.find({ driver: driverId }).sort({ submittedAt: -1, _id: -1 }).lean() as Promise<any[]>, settlementSource.load(driverId)]);
}

/** Live verification from the driver's real advance transactions. Nothing is written. */
export async function driverFinancials(driverId: unknown) {
  const [advances, settlements] = await advanceRows(driverId);
  const v = verifyAdvances(advances, settlements);
  return {
    ...v,
    advances: advances.slice(0, 20).map((a) => ({ _id: String(a._id), submittedAt: a.submittedAt, workingDays: a.workingDays, finalAdvanceAmount: a.finalAdvanceAmount, submittedBy: a.submittedBy })),
    settlements: settlements ?? [],
    settlementDataAvailable: settlements !== null,
  };
}
const verification = async (driverId: unknown): Promise<AdvanceVerification> => {
  const [advances, settlements] = await advanceRows(driverId);
  return verifyAdvances(advances, settlements);
};
const snap = (v: AdvanceVerification) => ({ status: v.status, totalAdvance: v.totalAdvance, totalSettled: v.totalSettled, outstanding: v.outstanding, message: v.message });

// ---------------------------------------------------------------- history + notifications

async function record(c: any, version: number, action: ClearanceAction, username: string, role: string, at: Date, details: Record<string, unknown> | null) {
  try {
    await ClearanceEvent.create({ clearance: c._id, version, action, username, role, at, details });
  } catch (e) {
    if (!isDup(e)) throw e; // already recorded (a retry): history is never doubled
  }
}

const brief = (c: any) => ({ trackupNumber: c.trackupNumber, clientName: c.clientName, vehicleNo: c.vehicleNo, driverNumber: c.driverNumber, driverName: c.driverName });
const refs = (c: any) => ({ vehicleId: String(c.vehicle), vehicleNo: c.vehicleNo, driverId: String(c.driver), driverNumber: c.driverNumber, driverName: c.driverName, allotmentId: String(c.allotment) });

async function notifyRsa(c: any, version: number, resubmitted: boolean, at: Date) {
  const type = resubmitted ? "CLEARANCE_RESUBMITTED" : "CLEARANCE_SUBMITTED";
  await notifyRole("RSA", {
    type,
    title: resubmitted ? "Vehicle & driver allocation resubmitted" : "Vehicle & driver clearance needed",
    message: `${resubmitted ? "A corrected vehicle and driver allocation has been resubmitted for RSA clearance" : "A new vehicle and driver allocation is waiting for RSA clearance"}. ${c.trackupNumber} (${c.pifNumber}) · ${c.clientName ?? "—"} · Vehicle ${c.vehicleNo} · ${c.driverNumber} ${c.driverName} · Submitted ${ist(at)}`,
    link: rsaLink(c._id), meta: { ...brief(c), version, submittedAt: at }, dedupeKey: `${type}:${c._id}:${version}`,
  });
}

async function notifyRbp(c: any, approved: boolean, by: string, at: Date, f: AdvanceVerification, reason?: string | null) {
  const type = approved ? "CLEARANCE_APPROVED" : "CLEARANCE_REJECTED";
  const payload = {
    type,
    title: approved ? "Vehicle & driver approved" : "Vehicle & driver rejected",
    message: `${approved ? "Your vehicle and driver allocation has been approved by RSA." : "Your vehicle and driver allocation has been rejected by RSA. Please review the rejection details."} ${c.trackupNumber} (${c.pifNumber}) · Vehicle ${c.vehicleNo} · ${c.driverNumber} ${c.driverName} · Outstanding advance ${inr(f.outstanding)} · ${approved ? "Approved" : `Rejected – ${reason}`} · Reviewed by ${by} on ${ist(at)}`,
    link: rbpLink(c._id),
    meta: { ...brief(c), status: approved ? "APPROVED" : "REJECTED", outstandingAdvance: f.outstanding, rejectionReason: reason ?? null, reviewedBy: by, reviewedAt: at, version: c.currentVersion },
    dedupeKey: `${type}:${c._id}:${c.currentVersion}`,
  } as const;
  // the RBP user who submitted it; when that account does not exist, every RBP user
  if (c.submittedBy && (await User.exists({ username: c.submittedBy, role: "RBP" }))) await notifyUsername(c.submittedBy, payload);
  else await notifyRole("RBP", payload);
}

// ---------------------------------------------------------------- sync: allotment -> clearance submission

const fromAllotment = (a: any, proj: any) => ({
  trackingVehicle: a.trackingVehicle, project: a.project, allotment: a._id, vehicle: a.vehicle, driver: a.driver,
  trackupNumber: a.trackupNumber, pifNumber: a.pifNumber, billNumber: a.billNumber ?? null, 
  clientName: proj?.clientName ?? a.clientName, projectType: proj?.projectType ?? a.projectType, projectName: a.projectName ?? null,
  vehicleNo: a.vehicleNo, driverNumber: a.driverNumber, driverName: a.driverName,
});

async function recordChanges(now: any, version: number, prev: any, by: string, at: Date) {
  if (String(prev.driver) !== String(now.driver))
    await record(now, version, "DRIVER_CHANGED", by, "RBP", at, { from: { driverId: String(prev.driver), driverNumber: prev.driverNumber, driverName: prev.driverName }, to: { driverId: String(now.driver), driverNumber: now.driverNumber, driverName: now.driverName } });
  if (String(prev.vehicle) !== String(now.vehicle))
    await record(now, version, "VEHICLE_CHANGED", by, "RBP", at, { from: { vehicleId: String(prev.vehicle), vehicleNo: prev.vehicleNo }, to: { vehicleId: String(now.vehicle), vehicleNo: now.vehicleNo } });
}

/**
 * Eligible allocations: an ACTIVE allotment that holds a driver, with a Trackup number, whose budget's latest version RSOM approved.
 * Compares each against its clearance row and (idempotently) creates version 1, refreshes a pending one, or - after an approved
 * allocation was changed - opens a new version. A REJECTED clearance is never touched: RBP resubmits it explicitly.
 */
export async function syncClearances(opts: { trackingVehicle?: unknown; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const first: any = { status: "ACTIVE", activeDriver: { $type: "objectId" }, trackupNumber: { $type: "string" } };
  if (opts.trackingVehicle) first.trackingVehicle = oid(opts.trackingVehicle);
  const rows: any[] = await VehicleAllotment.aggregate([
    { $match: first },
    { $lookup: { from: Budget.collection.name, localField: "trackingVehicle", foreignField: "vehicle", as: "budget" } },
    { $unwind: "$budget" },
    { $match: { "budget.approvalStatus": "APPROVED", $expr: { $eq: ["$budget.approvedVersion", "$budget.currentVersion"] } } },
    { $lookup: { from: Clearance.collection.name, localField: "trackingVehicle", foreignField: "trackingVehicle", as: "clr" } },
    { $addFields: { clr: { $arrayElemAt: ["$clr", 0] } } },
    { $match: { $or: [{ clr: { $exists: false } }, { $expr: { $or: [{ $ne: ["$clr.driver", "$driver"] }, { $ne: ["$clr.vehicle", "$vehicle"] }, { $ne: ["$clr.allotment", "$_id"] }] } }] } },
    { $limit: 500 },
  ]);
  let n = 0;
  for (const a of rows) {
    const c: any = a.clr;
    if (c?.status === "REJECTED") continue;
    const proj: any = await TrackingProject.findById(a.project).lean();
    const base = fromAllotment(a, proj);
    const by = a.driverAssignedBy ?? a.updatedBy;
    const at: Date = a.driverAssignedAt ?? now;
    try {
      const fin = await verification(a.driver);
      if (!c) {
        const doc: any = await Clearance.create({ ...base, currentVersion: 1, status: "YET_TO_APPROVE", submittedBy: by, submittedAt: at, outstandingAdvance: fin.outstanding, financialStatus: fin.status });
        await record(doc, 1, "ALLOCATED", by, "RBP", at, refs(doc));
        await record(doc, 1, "SUBMITTED", by, "RBP", at, { ...refs(doc), financial: snap(fin) });
        await notifyRsa(doc, 1, false, at);
        n++;
      } else if (c.status === "YET_TO_APPROVE") {
        const upd: any = await Clearance.findOneAndUpdate(
          { _id: c._id, status: "YET_TO_APPROVE", currentVersion: c.currentVersion },
          { $set: { ...base, outstandingAdvance: fin.outstanding, financialStatus: fin.status } }, { returnDocument: "after" },
        ).lean();
        if (upd) {
          await ClearanceEvent.create({ clearance: c._id, version: c.currentVersion, action: "ALLOCATION_UPDATED", username: by, role: "RBP", at, details: { from: refs(c), to: refs(upd), financial: snap(fin) } });
          n++;
        }
      } else if (c.status === "APPROVED") {
        // the approved vehicle / driver was changed afterwards: the new combination needs its own clearance (new version)
        const version = c.currentVersion + 1;
        const upd: any = await Clearance.findOneAndUpdate(
          { _id: c._id, status: "APPROVED", currentVersion: c.currentVersion },
          { $set: { ...base, currentVersion: version, status: "YET_TO_APPROVE", submittedBy: by, submittedAt: at, outstandingAdvance: fin.outstanding, financialStatus: fin.status }, $unset: { reviewedBy: 1, reviewedAt: 1, rejectionReason: 1, rejectionRemarks: 1, deliveryStatus: 1, deliveredAt: 1, deliveredBy: 1, delivery: 1 } }, // a changed allocation needs a fresh approval AND a fresh delivery (the earlier delivery record is kept)
          { returnDocument: "after" },
        ).lean();
        if (upd) {
          await recordChanges(upd, version, c, by, at);
          await record(upd, version, "SUBMITTED", by, "RBP", at, { ...refs(upd), financial: snap(fin), reason: "Allocation changed after approval" });
          await notifyRsa(upd, version, true, at);
          n++;
        }
      }
    } catch (e) {
      if (!isDup(e)) throw e; // a concurrent sync created it first
    }
  }
  return n;
}

// ---------------------------------------------------------------- listing

export interface ClearanceQuery { q?: string; status?: string; projectType?: string; from?: string; to?: string; page?: number; limit?: number }

export function clearanceFilter(q: ClearanceQuery): Record<string, unknown> {
  const and: any[] = [];
  if (q.q?.trim()) {
    const rx = new RegExp(esc(q.q.trim()), "i");
    and.push({ $or: [{ trackupNumber: rx }, { pifNumber: rx }, { billNumber: rx }, { clientName: rx }, { projectName: rx }, { vehicleNo: rx }, { driverNumber: rx }, { driverName: rx }] });
  }
  if (q.status && ["YET_TO_APPROVE", "APPROVED", "REJECTED"].includes(q.status)) and.push({ status: q.status });
  else if (q.status === "YET_TO_DELIVER") and.push({ status: "APPROVED", deliveryStatus: { $ne: "DELIVERED" } }); // approved and not delivered yet
  else if (q.status === "DELIVERED") and.push({ deliveryStatus: "DELIVERED" });
  if (q.projectType && ["ROADSHOW", "SIGNAGE"].includes(q.projectType)) and.push({ projectType: q.projectType });
  if (q.from && YMD.test(q.from)) and.push({ submittedAt: { $gte: new Date(`${q.from}T00:00:00+05:30`) } }); // IST day boundaries
  if (q.to && YMD.test(q.to)) and.push({ submittedAt: { $lte: new Date(`${q.to}T23:59:59.999+05:30`) } });
  return and.length ? { $and: and } : {};
}

const row = (c: any) => ({
  _id: String(c._id), trackupNumber: c.trackupNumber, pifNumber: c.pifNumber, billNumber: c.billNumber ?? null, projectType: c.projectType ?? null, clientName: c.clientName ?? null,
  vehicleNo: c.vehicleNo, driverNumber: c.driverNumber, driverName: c.driverName, outstandingAdvance: c.outstandingAdvance ?? null, financialStatus: c.financialStatus ?? null,
  status: c.status as ClearanceStatus, version: c.currentVersion, submittedAt: c.submittedAt, submittedBy: c.submittedBy, reviewedAt: c.reviewedAt ?? null, reviewedBy: c.reviewedBy ?? null,
  rejectionReason: c.rejectionReason ?? null, projectName: c.projectName ?? null,
  // delivery is separate from the RSA status: only an RSA-approved allocation can be Yet to Deliver / Delivered
  deliveryStatus: c.status === "APPROVED" ? (c.deliveryStatus ?? "YET_TO_DELIVER") : null, deliveredAt: c.deliveredAt ?? null, deliveredBy: c.deliveredBy ?? null,
  approvedAt: c.status === "APPROVED" ? c.reviewedAt ?? null : null, approvedBy: c.status === "APPROVED" ? c.reviewedBy ?? null : null,
});

async function safeSync() {
  try {
    await syncClearances();
  } catch (e) {
    console.error("Clearance sync failed", e); // listing still works from what is already stored
  }
}

export async function listClearances(q: ClearanceQuery) {
  await safeSync();
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const filter = clearanceFilter(q);
  const [items, total] = await Promise.all([
    Clearance.find(filter).sort({ submittedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Clearance.countDocuments(filter),
  ]);
  return { items: (items as any[]).map(row), total, page, limit };
}

export async function clearanceSummary(projectType?: string) {
  await safeSync();
  const g: any[] = await Clearance.aggregate([{ $match: asVertical(projectType) ? { projectType } : {} }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const by = (s: string) => g.find((x) => x._id === s)?.n ?? 0;
  const yet = by("YET_TO_APPROVE"), approved = by("APPROVED"), rejected = by("REJECTED");
  return { total: yet + approved + rejected, yetToApprove: yet, approved, rejected };
}

// ---------------------------------------------------------------- detail

const docs = (v: any) =>
  DOC_SECTIONS.flatMap((s) => ((v?.[s] ?? []) as any[]).map((e) => ({ section: s, nextRenewalDate: e.nextRenewalDate ?? null, attachment: e.attachment ? { name: e.attachment.name, url: attachmentUrl(e.attachment) } : null })));

export async function loadOne(id: string) {
  if (!validId(id)) throw new AppError("Invalid clearance id", 400);
  const c: any = await Clearance.findById(id).lean();
  if (!c) throw new AppError("Clearance not found", 404);
  return c;
}

/** Everything the review / detail pages show, read from the real records. Financials are recomputed on every call. */
export async function clearanceDetail(id: string) {
  const c0 = await loadOne(id);
  await syncClearances({ trackingVehicle: c0.trackingVehicle }).catch(() => 0);
  const c: any = await Clearance.findById(id).lean();
  const [a, proj, budget, veh, drv, events, curAllot]: any[] = await Promise.all([
    VehicleAllotment.findById(c.allotment).lean(),
    TrackingProject.findById(c.project).lean(),
    Budget.findOne({ vehicle: c.trackingVehicle }).lean(),
    Vehicle.findById(c.vehicle).lean(),
    Driver.findById(c.driver).lean(),
    ClearanceEvent.find({ clearance: c._id }).sort({ at: -1, _id: -1 }).lean(),
    VehicleAllotment.findOne({ trackingVehicle: c.trackingVehicle, status: "ACTIVE" }).lean(),
  ]);
  const [fin, version, bEvent, drvEvent]: any[] = await Promise.all([
    driverFinancials(c.driver),
    budget ? BudgetVersion.findOne({ budget: budget._id, version: budget.approvedVersion }).select("total").lean() : null,
    budget ? BudgetEvent.findOne({ budget: budget._id, version: budget.approvedVersion, action: "APPROVED" }).lean() : null,
    AllotmentEvent.findOne({ allotment: c.allotment, action: { $in: ["DRIVER_ASSIGNED", "DRIVER_CHANGED"] } }).sort({ createdAt: -1 }).lean(),
  ]);
  const d = proj?.details ?? {};
  const roadshow = proj?.projectType === "ROADSHOW";
  const allocationActive = !!curAllot && !!curAllot.activeDriver;
  const matches = allocationActive && String(curAllot.driver) === String(c.driver) && String(curAllot.vehicle) === String(c.vehicle);
  const budgetOk = !!budget && budget.approvalStatus === "APPROVED" && budget.approvedVersion === budget.currentVersion;
  const reviewable = c.status === "YET_TO_APPROVE" && matches && budgetOk;
  return {
    ...row(c),
    project: {
      trackupNumber: c.trackupNumber, pifNumber: c.pifNumber, billNumber: c.billNumber ?? null, projectType: c.projectType ?? null, projectName: c.projectName ?? null, clientName: c.clientName ?? null,
      requestedVehicleType: a?.requestedVehicleType ?? null,
      projectFrom: (roadshow ? d.startDate : d.fromDate) ?? a?.projectStart ?? null, projectTo: (roadshow ? d.endDate : d.toDate) ?? a?.projectEnd ?? null,
      location: roadshow ? (d.reportingLocations ?? []).join(", ") || null : d.location ?? null,
      approvedBudgetAmount: version?.total ?? budget?.total ?? null, budgetNumber: budget?.budgetNumber ?? null,
      rsomStatus: budget?.approvalStatus ?? null, rsomApprovedVersion: budget?.approvedVersion ?? null, rsomApprovedBy: bEvent?.username ?? budget?.reviewedBy ?? null, rsomApprovedAt: bEvent?.createdAt ?? budget?.reviewedAt ?? null,
    },
    vehicle: {
      _id: String(c.vehicle), vehicleNo: c.vehicleNo, make: veh?.make ?? a?.vehicleMake ?? null, model: veh?.model ?? a?.vehicleModel ?? null, type: veh?.type ?? null, status: veh?.status ?? null,
      availabilityStatus: veh?.availability?.status ?? null, allottedAt: a?.allottedAt ?? null, expectedReleaseAt: a?.expectedReleaseAt ?? null, nextAvailableAt: a?.nextAvailableAt ?? null, documents: docs(veh),
    },
    driver: {
      _id: String(c.driver), driverNumber: c.driverNumber, driverName: c.driverName, driverType: drv?.driverType ?? a?.driverType ?? null, mobileNumber: drv?.mobileNumber ?? a?.driverMobile ?? null,
      licenceNumber: drv?.licenceNumber ?? null, licenceType: drv?.licenceType ?? null, licenceExpiryDate: drv?.licenceExpiryDate ?? null,
      availabilityStatus: drv?.availability?.status ?? null, assignedAt: a?.driverAssignedAt ?? null, assignedBy: a?.driverAssignedBy ?? null, remarks: drvEvent?.details?.remarks ?? null,
      bank: { accountName: drv?.accountName ?? null, bankName: drv?.bankName ?? null, accountNumberMasked: maskAccount(drv?.accountNumber), ifscCode: drv?.ifscCode ?? null },
    },
    financial: { ...fin, previousData: await countedHistorical(c.trackingVehicle, c.driver) }, // shown only: clearance rules are unchanged
    rejection: c.status === "REJECTED" ? { reason: c.rejectionReason ?? null, remarks: c.rejectionRemarks ?? null, rejectedBy: c.reviewedBy ?? null, rejectedAt: c.reviewedAt ?? null } : null,
    // the vehicle / driver currently allotted, so RBP can see whether a rejected allocation was already corrected
    current: curAllot ? { allotmentId: String(curAllot._id), vehicleNo: curAllot.vehicleNo, driverNumber: curAllot.driverNumber ?? null, driverName: curAllot.driverName ?? null, hasDriver: !!curAllot.activeDriver } : null,
    allocationActive, changedSinceSubmission: allocationActive && !matches,
    canApprove: reviewable && fin.canApprove,
    approveBlockedReason:
      c.status !== "YET_TO_APPROVE" ? `This allocation is already ${c.status === "APPROVED" ? "approved" : "rejected"}`
        : !budgetOk ? "The latest budget is not approved by RSOM"
          : !matches ? "The vehicle / driver allocation changed; refresh to review the latest submission"
            : fin.canApprove ? null : fin.message,
    canResubmit: c.status === "REJECTED" && allocationActive && budgetOk,
    history: events.map((e: any) => ({ _id: String(e._id), version: e.version, action: e.action, username: e.username, role: e.role, at: e.at, details: e.details })),
  };
}

// ---------------------------------------------------------------- RSA: approve / reject

async function reviewableClearance(id: string, version: unknown) {
  const c = await loadOne(id);
  if (version !== undefined && version !== null && Number(version) !== c.currentVersion) throw new AppError("A newer submission exists; refresh and review the latest version", 409);
  if (c.status !== "YET_TO_APPROVE") throw new AppError(`This allocation is already ${c.status === "APPROVED" ? "approved" : "rejected"}`, 409);
  await syncClearances({ trackingVehicle: c.trackingVehicle }).catch(() => 0);
  const fresh = await loadOne(id);
  if (fresh.currentVersion !== c.currentVersion || fresh.status !== "YET_TO_APPROVE" || String(fresh.driver) !== String(c.driver) || String(fresh.vehicle) !== String(c.vehicle))
    throw new AppError("The vehicle / driver allocation changed; refresh and review the latest submission", 409);
  const active: any = await VehicleAllotment.findOne({ trackingVehicle: fresh.trackingVehicle, status: "ACTIVE" }).select("driver vehicle activeDriver").lean();
  if (!active?.activeDriver || String(active.driver) !== String(fresh.driver) || String(active.vehicle) !== String(fresh.vehicle)) throw new AppError("This vehicle and driver allocation is no longer active", 409);
  const budget: any = await Budget.findOne({ vehicle: fresh.trackingVehicle }).select("approvalStatus approvedVersion currentVersion").lean();
  if (!budget || budget.approvalStatus !== "APPROVED" || budget.approvedVersion !== budget.currentVersion) throw new AppError("The latest budget of this project is not approved by RSOM", 409);
  return fresh;
}

export async function approveClearance(id: string, input: unknown, username: string, now = new Date()) {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const c = await reviewableClearance(id, b.version);
  const fin = await verification(c.driver); // recomputed now: what the page showed earlier is never trusted
  if (fin.status === "UNAVAILABLE") throw new AppError("Verification Data Unavailable: the driver's advance cannot be verified, so it cannot be approved", 409);
  if (!fin.canApprove) throw new AppError("Outstanding driver advance exists", 400);
  const upd: any = await Clearance.findOneAndUpdate(
    { _id: c._id, status: "YET_TO_APPROVE", currentVersion: c.currentVersion }, // a second / concurrent review finds nothing here
    { $set: { status: "APPROVED", reviewedBy: username, reviewedAt: now, outstandingAdvance: fin.outstanding, financialStatus: fin.status }, $unset: { rejectionReason: 1, rejectionRemarks: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!upd) throw new AppError("This allocation was just reviewed by someone else; refresh", 409);
  await record(upd, upd.currentVersion, "APPROVED", username, "RSA", now, { ...refs(upd), financial: snap(fin) });
  await notifyRbp(upd, true, username, now, fin);
  return row(upd);
}

export interface RejectInput { reason: string; remarks: string | null; attachments: any[] }
export function validateReject(input: unknown): { errors: string[]; data: RejectInput | null } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason) errors.push("Rejection reason is required");
  else if (!(REJECTION_REASONS as readonly string[]).includes(reason)) errors.push("Choose one of the listed rejection reasons");
  let remarks: string | null = null;
  if (b.remarks !== undefined && b.remarks !== null && b.remarks !== "") {
    if (typeof b.remarks !== "string") errors.push("Remarks are invalid");
    else if (b.remarks.trim().length > 500) errors.push("Remarks are too long (max 500)");
    else remarks = b.remarks.trim();
  }
  if (reason === "Other" && (!remarks || remarks.length < 5)) errors.push("A detailed explanation is required when the reason is Other");
  const attachments = parseAttachments(b.attachments, errors);
  return errors.length ? { errors, data: null } : { errors, data: { reason, remarks, attachments } };
}

export async function rejectClearance(id: string, input: unknown, username: string, now = new Date()) {
  const v = validateReject(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const c = await reviewableClearance(id, (input as any)?.version);
  const fin = await verification(c.driver); // snapshot of what RSA saw (an unverifiable result is stored as such, never as zero)
  const upd: any = await Clearance.findOneAndUpdate(
    { _id: c._id, status: "YET_TO_APPROVE", currentVersion: c.currentVersion },
    { $set: { status: "REJECTED", reviewedBy: username, reviewedAt: now, outstandingAdvance: fin.outstanding, financialStatus: fin.status, rejectionReason: v.data.reason, rejectionRemarks: v.data.remarks } },
    { returnDocument: "after" },
  ).lean();
  if (!upd) throw new AppError("This allocation was just reviewed by someone else; refresh", 409);
  await record(upd, upd.currentVersion, "REJECTED", username, "RSA", now, { ...refs(upd), financial: snap(fin), reason: v.data.reason, remarks: v.data.remarks, attachments: v.data.attachments });
  await notifyRbp(upd, false, username, now, fin, v.data.reason);
  return row(upd);
}

// ---------------------------------------------------------------- RBP: resubmit

/** Resubmits a REJECTED allocation as a NEW version (the rejected version stays as it was). Uses the vehicle / driver currently allotted. */
export async function resubmitClearance(id: string, input: unknown, username: string, now = new Date()) {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const remarks = typeof b.remarks === "string" && b.remarks.trim() ? b.remarks.trim().slice(0, 500) : null;
  const c = await loadOne(id);
  if (c.status !== "REJECTED") throw new AppError(c.status === "YET_TO_APPROVE" ? "This allocation is already waiting for RSA approval" : "Only a rejected allocation can be resubmitted", 409);
  const a: any = await VehicleAllotment.findOne({ trackingVehicle: c.trackingVehicle, status: "ACTIVE" }).lean();
  if (!a || !a.activeDriver) throw new AppError("No active vehicle and driver allocation exists; allot a vehicle and driver before resubmitting", 409);
  const budget: any = await Budget.findOne({ vehicle: c.trackingVehicle }).lean();
  if (!budget || budget.approvalStatus !== "APPROVED" || budget.approvedVersion !== budget.currentVersion) throw new AppError("The latest budget of this project is not approved by RSOM", 409);
  const proj: any = await TrackingProject.findById(a.project).lean();
  const fin = await verification(a.driver); // the (possibly new) driver's own history; the previous driver's is never reused
  const version = c.currentVersion + 1;
  const upd: any = await Clearance.findOneAndUpdate(
    { _id: c._id, status: "REJECTED", currentVersion: c.currentVersion },
    { $set: { ...fromAllotment(a, proj), currentVersion: version, status: "YET_TO_APPROVE", submittedBy: username, submittedAt: now, outstandingAdvance: fin.outstanding, financialStatus: fin.status }, $unset: { reviewedBy: 1, reviewedAt: 1, rejectionReason: 1, rejectionRemarks: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!upd) throw new AppError("This allocation was just resubmitted; refresh", 409);
  await recordChanges(upd, version, c, username, now);
  await record(upd, version, "RESUBMITTED", username, "RBP", now, { ...refs(upd), previousVersion: c.currentVersion, financial: snap(fin), remarks });
  await notifyRsa(upd, version, true, now);
  return row(upd);
}
