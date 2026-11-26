/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import type { RoleKey } from "../config/roles.js";
import { rsaOptions } from "../config/rsaOptions.js";
import { AllotmentEvent } from "../models/VehicleAllotment.js";
import { Budget } from "../models/Budget.js";
import { Driver } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { Counter, RsaPayment } from "../models/RsaPayment.js";
import { ENTRY_PAYMENT_MODES, PAYMENT_MODE_LABEL, SettlementPayment, SettlementPaymentEvent, type PaymentCategory } from "../models/SettlementPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { AppError } from "../utils/AppError.js";
import { financialYear } from "../utils/numbers.js";
import { kmAllowanceOf } from "../utils/kmAllowance.js";
import { maskTail, seal } from "../utils/secureField.js";
import { daysBetween, dailyData, finalData, FINAL_EXPENSE_CATEGORIES, DEDUCTION_LABELS, validateDailyInput, validateFinalInput } from "../utils/settlement.js";
import { notifyRole, notifyUsername } from "./notification.service.js";
import { checkAdvanceEligibility, listEligibleProjects, projectContext, viewBudget, viewDriver, type EligibleQuery } from "./rsa.service.js";

/**
 * Daily vehicle payments and final driver settlements.
 * Who does what (enforced here and in the routes):
 *   RBP  submits both categories and resubmits rejected ones
 *   RSOM approves / rejects DAILY only;  RSO approves / rejects FINAL only
 *   RSA  sees pending + approved entries, exports approved ones and records the accounts payment reference (-> COMPLETED)
 */
export const APPROVER: Record<PaymentCategory, RoleKey> = { DAILY: "RSOM", FINAL: "RSO" };
export const CATEGORY_LABEL: Record<PaymentCategory, string> = { DAILY: "Daily Vehicle Payment", FINAL: "Final Driver Settlement" };

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Printable text: no angle brackets and no control characters. */
const SAFE_TEXT = { test: (t: string) => t.length > 0 && ![...t].some((ch) => ch === "<" || ch === ">" || ch < " " || ch === "\u007f") };

// ------------------------------------------------------------------------------------------------ transactions

let txnSupport: boolean | null = null;
/** Transactions need a replica set / sharded cluster. On a standalone server (local dev) the steps run without one; every
 *  state change is still a single conditional (atomic) update, so a lost race can never approve or complete twice. */
async function supportsTxn(): Promise<boolean> {
  if (txnSupport !== null) return txnSupport;
  try {
    const h: any = await mongoose.connection.db!.admin().command({ hello: 1 });
    txnSupport = !!h.setName || h.msg === "isdbgrid";
  } catch {
    txnSupport = false;
  }
  return txnSupport;
}
export async function inTxn<T>(fn: (session: mongoose.ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await supportsTxn())) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let out: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out!;
  } finally {
    await session.endSession();
  }
}

async function nextNumber(category: PaymentCategory, now: Date, session?: mongoose.ClientSession): Promise<string> {
  const fy = financialYear(now);
  const prefix = category === "DAILY" ? "DVP" : "DSE";
  const c: any = await Counter.findOneAndUpdate({ _id: `settlement:${prefix}:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after", session }).lean();
  return `${prefix}-${String(c.seq).padStart(6, "0")}/${fy}`;
}

async function logEvent(p: any, action: string, username: string, role: string, extra: { fromStatus?: string; comment?: string; snapshot?: unknown } = {}, session?: mongoose.ClientSession) {
  await SettlementPaymentEvent.create([{
    payment: p._id, paymentNumber: p.paymentNumber, category: p.category, version: p.version, action, fromStatus: extra.fromStatus, toStatus: p.status,
    username, role, comment: extra.comment, amount: p.amount, snapshot: extra.snapshot,
  }], { session });
}

// ------------------------------------------------------------------------------------------------ project context

const campaignOf = (proj: any) => {
  const d = proj?.details ?? {};
  const roadshow = proj?.projectType === "ROADSHOW";
  const fromDate: string | null = (roadshow ? d.startDate : d.fromDate) ?? null;
  const toDate: string | null = (roadshow ? d.endDate : d.toDate) ?? null;
  const locs = Array.isArray(d.reportingLocations) ? d.reportingLocations.map((l: any) => (typeof l === "string" ? l : l?.location ?? l?.name ?? "")).filter(Boolean) : [];
  return {
    fromDate, toDate,
    totalDays: (roadshow ? d.numberOfDays : d.totalDaysOfWork) ?? (fromDate && toDate && YMD.test(fromDate) && YMD.test(toDate) ? daysBetween(fromDate, toDate) : null),
    location: roadshow ? locs.join(", ") || null : d.location ?? null,
    jsNumber: d.jobSheetNumber ?? null,
    reportingDate: d.reportingDate ?? null,
    sundayHalt: roadshow && d.sundayHalt === "YES", // the RSOP tracking rule: Sundays are halt days for this campaign
    km: kmAllowanceOf(proj?.projectType, d), // KM / day x days + the one-time Extra KM pool (RoadShow only, else null)
  };
};

/** Read-only context of an eligible project vehicle (approved current budget + allotted driver), with prefill values. */
export async function settlementContext(tvId: string) {
  const ctx = await projectContext(tvId);
  const [proj, budget, driver]: any[] = await Promise.all([
    TrackingProject.findById(ctx._raw.project).lean(),
    Budget.findOne({ vehicle: tvId }).lean(),
    Driver.findById(ctx._raw.driver).lean(),
  ]);
  const camp = campaignOf(proj);
  const bd = budget?.data ?? {};
  const perDay = (amt: unknown, unit: unknown, days: number) => (unit === "PER_CAMPAIGN" && days ? Math.round((Number(amt) / days) * 100) / 100 : Number(amt) || 0);
  const days = Number(bd.numberOfDays) || camp.totalDays || 0;
  const changes: any[] = await AllotmentEvent.find({ allotment: ctx._raw.allotment, action: "DRIVER_CHANGED" }).lean();
  const travelDeduction = changes.filter((e) => e.details?.from?.driverId === ctx._raw.driver).reduce((s, e) => s + (Number(e.details?.travelAmountDeduction) || 0), 0);
  const [advances, dailyAdvances, existingFinal, rsaEntries]: any[] = await Promise.all([
    DriverAdvance.find({ driver: ctx._raw.driver, submittedAt: { $gte: new Date(`${camp.fromDate ?? "1970-01-01"}T00:00:00+05:30`) } }).select("finalAdvanceAmount workingDays submittedAt submittedBy").sort({ submittedAt: 1 }).lean(),
    SettlementPayment.find({ allotment: ctx._raw.allotment, driver: ctx._raw.driver, category: "DAILY", status: { $ne: "REJECTED" } }).select("paymentNumber status fromDate toDate amount submittedAt completion data.salaryAdvance data.dieselTotal data.foodAmount data.cashInHand data.dieselEntries").sort({ fromDate: 1 }).lean(),
    SettlementPayment.findOne({ finalLock: `${ctx._raw.allotment}:${ctx._raw.driver}` }).select("paymentNumber status").lean(),
    RsaPayment.find({ trackingVehicle: tvId }).select("paymentNumber entryDateTime totalPayable cashInHand dieselEntries").sort({ entryDateTime: -1 }).limit(100).lean(),
  ]);
  const paidDaily = dailyAdvances.filter((p: any) => p.status === "APPROVED" || p.status === "COMPLETED"); // only approved daily payments count as paid
  const advanceTotal = advances.reduce((s: number, a: any) => s + (a.finalAdvanceAmount ?? 0), 0) + paidDaily.reduce((s: number, p: any) => s + (p.data?.salaryAdvance ?? 0), 0);
  return {
    trackingVehicle: ctx.trackingVehicle, trackupNumber: ctx.trackupNumber, pifNumber: ctx.pifNumber, clientName: ctx.clientName, projectType: ctx.projectType,
    vehicleNo: ctx.vehicle.vehicleNo, driverNumber: ctx.driver.driverNumber, driverName: ctx.driver.driverName, approvedBudgetAmount: ctx.approvedBudgetAmount, budgetVersion: ctx.budgetVersion,
    campaign: camp,
    bank: { accountName: driver?.accountName ?? null, bankName: driver?.bankName ?? null, ifscCode: driver?.ifscCode ?? null, accountMasked: maskTail(driver?.accountNumber) },
    existingFinal: existingFinal ? { paymentNumber: existingFinal.paymentNumber, status: existingFinal.status } : null,
    // the suspense amount breakdown and the on-road report (existing payment records of this driver on this vehicle)
    advances: advances.map((a: any) => ({ source: "Driver Advance", date: a.submittedAt, amount: a.finalAdvanceAmount ?? 0, note: `${a.workingDays} working days · ${a.submittedBy}` })),
    // previous payments of this project vehicle: daily settlements (any status but rejected) and the RSA payment entries
    previousPayments: [
      ...dailyAdvances.map((p: any) => ({
        source: "DAILY", paymentNumber: p.paymentNumber, status: p.status, date: p.completion?.paymentDate ?? p.fromDate, amount: p.amount,
        mode: (p.completion ? PAYMENT_MODE_LABEL[p.completion.paymentMode] ?? p.completion.paymentMode : null) ?? (p.data?.cashInHand ? "Cash" : ([...new Set((p.data?.dieselEntries ?? []).map((x: any) => x.mode).filter(Boolean))].join(", ") || "ePayment")),
        bankName: p.completion?.bankName ?? ((p.data?.dieselEntries ?? []).map((x: any) => x.reference).filter(Boolean).join(", ") || null),
        referenceNumber: p.completion?.referenceNumber ?? null,
      })),
      ...rsaEntries.map((p: any) => ({
        source: "RSA", paymentNumber: p.paymentNumber, status: "ENTERED", date: new Date(new Date(p.entryDateTime).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10), amount: p.totalPayable,
        mode: p.cashInHand ? "Cash" : [...new Set((p.dieselEntries ?? []).map((x: any) => x.mode).filter(Boolean))].join(", ") || "ePayment",
        bankName: (p.dieselEntries ?? []).map((x: any) => x.reference).filter(Boolean).join(", ") || null,
      })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    dailyPayments: dailyAdvances.map((p: any) => ({ paymentNumber: p.paymentNumber, status: p.status, fromDate: p.fromDate, toDate: p.toDate, amount: p.amount, salaryAdvance: p.data?.salaryAdvance ?? 0, diesel: p.data?.dieselTotal ?? 0, food: p.data?.foodAmount ?? 0 })),
    prefill: {
      // Signage carries a job sheet no; for RoadShow the trackup no is the JS no
      jsNumber: camp.jsNumber ?? ctx.trackupNumber, location: camp.location, reportingDate: camp.reportingDate,
      estimatedKmPerDay: Number(bd.estimatedKmPerDay) || 0, fixedMileage: Number(bd.mileage) || 0,
      estimatedBudget: budget?.total ?? 0, estimatedKm: Number(bd.totalKm) || (Number(bd.estimatedKmPerDay) || 0) * days,
      estimatedFuel: Number(bd.mileage) ? Math.round((((Number(bd.totalKm) || (Number(bd.estimatedKmPerDay) || 0) * days) / Number(bd.mileage)) * 100)) / 100 : 0,
      perDaySalary: perDay(bd.salaryAmount, bd.salaryUnit, days) || Number(driver?.salary) || 0, perDayFood: perDay(bd.foodAmount, bd.foodUnit, days), haltDayPay: Number(bd.haltFood) || 0,
      driverChangeTravel: travelDeduction, suspenseAmount: advanceTotal,
    },
  };
}

// ------------------------------------------------------------------------------------------------ views

const shape = (p: any) => ({
  _id: String(p._id), paymentNumber: p.paymentNumber, category: p.category, categoryLabel: CATEGORY_LABEL[p.category as PaymentCategory], status: p.status, version: p.version,
  trackingVehicle: String(p.trackingVehicle), trackupNumber: p.trackupNumber, pifNumber: p.pifNumber ?? null, jsNumber: p.jsNumber ?? null, clientName: p.clientName ?? null, projectType: p.projectType,
  vehicleNo: p.vehicleNo ?? null, driverNumber: p.driverNumber ?? null, driverName: p.driverName ?? null, fromDate: p.fromDate, toDate: p.toDate, amount: p.amount,
  bank: p.bank ? { accountName: p.bank.accountName ?? null, bankName: p.bank.bankName ?? null, ifscCode: p.bank.ifscCode ?? null, accountMasked: p.bank.accountMasked ?? null } : null,
  submittedBy: p.submittedBy, submittedRole: p.submittedRole ?? "RBP", submittedAt: p.submittedAt, reviewedBy: p.reviewedBy ?? null, reviewedRole: p.reviewedRole ?? null, reviewedAt: p.reviewedAt ?? null,
  rejectionReason: p.rejectionReason ?? null, approver: APPROVER[p.category as PaymentCategory], exportedAt: p.exportedAt ?? null, exportCount: p.exportCount ?? 0,
  completion: p.completion ? { referenceNumber: p.completion.referenceNumber, referenceDate: p.completion.referenceDate ?? null, paymentDate: p.completion.paymentDate, paymentMode: p.completion.paymentMode, bankName: p.completion.bankName ?? null, transactionMasked: p.completion.transactionMasked ?? null, remarks: p.completion.remarks ?? null, completedBy: p.completion.completedBy, completedAt: p.completion.completedAt } : null,
});
export type SettlementView = ReturnType<typeof shape>;

export async function getSettlement(id: string) {
  if (!validId(id)) throw new AppError("Invalid payment id", 400);
  const p: any = await SettlementPayment.findById(id).lean();
  if (!p) throw new AppError("Payment not found", 404);
  const events: any[] = await SettlementPaymentEvent.find({ payment: p._id }).sort({ createdAt: 1, _id: 1 }).lean();
  return {
    ...shape(p), data: p.data,
    history: events.map((e) => ({ action: e.action, version: e.version, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null, username: e.username, role: e.role, comment: e.comment ?? null, amount: e.amount ?? null, createdAt: e.createdAt })),
  };
}

export interface ListQuery { scope?: string; category?: string; status?: string; q?: string; from?: string; to?: string; projectType?: string; page?: number; limit?: number; sort?: string; dir?: string }
const SORTS: Record<string, string> = { submittedAt: "submittedAt", amount: "amount", paymentNumber: "paymentNumber", fromDate: "fromDate", status: "status", driverName: "driverName", vehicleNo: "vehicleNo" };

/** Common approval queue. Completed payments are listed separately (`status=COMPLETED`). */
export function listFilter(q: ListQuery, role: RoleKey) {
  const and: any[] = [];
  if (q.category === "DAILY" || q.category === "FINAL") and.push({ category: q.category });
  // scope=all: the shared Driver Payments module (RBP and RSA see the same full list, paid entries included: they stay there with
  // "Entry Completed" and also appear in Payment Completed). RSA's accounts queue (no scope) stays pending + approved only.
  const shared = q.scope === "all" && (role === "RBP" || role === "RSA");
  const queue = shared ? ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] : role === "RSA" ? ["PENDING", "APPROVED"] : ["PENDING", "APPROVED", "REJECTED"];
  if (q.status === "COMPLETED") and.push({ status: "COMPLETED" });
  else if (q.status && queue.includes(q.status)) and.push({ status: q.status });
  else and.push({ status: { $in: queue } });
  if (q.projectType === "ROADSHOW" || q.projectType === "SIGNAGE") and.push({ projectType: q.projectType });
  const t = q.q?.trim();
  if (t) {
    const rx = new RegExp(esc(t), "i");
    and.push({ $or: [{ paymentNumber: rx }, { trackupNumber: rx }, { pifNumber: rx }, { jsNumber: rx }, { clientName: rx }, { vehicleNo: rx }, { driverName: rx }, { driverNumber: rx }, { submittedBy: rx }, { "completion.referenceNumber": rx }] });
  }
  if (q.from && YMD.test(q.from)) and.push({ toDate: { $gte: q.from } }); // period overlaps [from, to]
  if (q.to && YMD.test(q.to)) and.push({ fromDate: { $lte: q.to } });
  return { $and: and };
}

export async function listSettlements(q: ListQuery, role: RoleKey) {
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const filter = listFilter(q, role);
  const sortKey = SORTS[q.sort ?? ""] ?? "submittedAt";
  const dir = q.dir === "asc" ? 1 : -1;
  const [items, total, counts]: any[] = await Promise.all([
    SettlementPayment.find(filter).sort({ [sortKey]: dir, _id: dir }).skip((page - 1) * limit).limit(limit).lean(),
    SettlementPayment.countDocuments(filter),
    SettlementPayment.aggregate([{ $group: { _id: { c: "$category", s: "$status" }, n: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
  ]);
  const summary: Record<string, { count: number; amount: number }> = {};
  for (const c of counts) {
    const k = `${c._id.c}:${c._id.s}`;
    summary[k] = { count: c.n, amount: Math.round(c.amount * 100) / 100 };
  }
  return { items: items.map(shape), total, page, limit, summary };
}

// ------------------------------------------------------------------------------------------------ submit / resubmit

async function snapshotRefs(tvId: string) {
  const ctx = await projectContext(tvId);
  const [proj, budget, driver]: any[] = await Promise.all([
    TrackingProject.findById(ctx._raw.project).lean(), Budget.findOne({ vehicle: tvId }).select("_id").lean(), Driver.findById(ctx._raw.driver).lean(),
  ]);
  const camp = campaignOf(proj);
  return {
    ctx, camp,
    refs: {
      project: ctx._raw.project, trackingVehicle: tvId, allotment: ctx._raw.allotment, budget: budget._id, vehicle: ctx._raw.vehicle, driver: ctx._raw.driver,
      trackupNumber: ctx.trackupNumber, pifNumber: ctx.pifNumber, clientName: ctx.clientName, projectType: ctx.projectType, vehicleNo: ctx.vehicle.vehicleNo,
      driverNumber: ctx.driver.driverNumber, driverName: ctx.driver.driverName,
      bank: { accountName: driver?.accountName, bankName: driver?.bankName, ifscCode: driver?.ifscCode, accountMasked: maskTail(driver?.accountNumber) ?? undefined, account: seal(driver?.accountNumber) },
    },
  };
}

function buildDaily(input: unknown, projectType: string, camp: { fromDate: string | null; toDate: string | null }, previous?: { fromDate?: string; toDate?: string }) {
  const v = validateDailyInput(input, { campaignFrom: camp.fromDate, campaignTo: camp.toDate, previous });
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  if (v.data.paymentFor && v.data.paymentFor !== projectType) throw new AppError(`Payment For must be ${projectType === "ROADSHOW" ? "RoadShow" : "Signage"} for this project`, 400);
  const data = dailyData({ ...v.data, paymentFor: (v.data.paymentFor ?? projectType) as any });
  return { data, key: v.data.idempotencyKey, fromDate: v.data.fromDate, toDate: v.data.toDate, amount: data.totalPayable };
}

function buildFinal(input: unknown, camp: ReturnType<typeof campaignOf>) {
  if (!camp.fromDate || !camp.toDate) throw new AppError("The campaign period of this project is not set", 409);
  const v = validateFinalInput(input, { totalDays: daysBetween(camp.fromDate, camp.toDate), fromDate: camp.fromDate, toDate: camp.toDate }); // on-road + Sunday + halt days and reporting date fit inside the campaign calendar
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const data = finalData(v.data, { fromDate: camp.fromDate, toDate: camp.toDate, totalDays: camp.totalDays, km: camp.km });
  return { data, key: v.data.idempotencyKey, fromDate: camp.fromDate, toDate: camp.toDate, amount: data.netAmount };
}

/**
 * A payment reference identifies one payment of a category: it may not be recorded on another record of that category.
 * Compared without case ("utr1" = "UTR1"). Callers hold `refLock(category, ref)` so two simultaneous saves cannot both pass.
 */
async function assertReferenceFree(category: PaymentCategory, ref: string, exceptId?: unknown) {
  const rx = new RegExp(`^${esc(ref)}$`, "i");
  const clash: any = await SettlementPayment.findOne({ category, "completion.referenceNumber": rx, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select("paymentNumber").lean();
  if (clash) throw new AppError(`Reference number ${ref} is already recorded on ${clash.paymentNumber}`, 409);
}
const refLock = (category: PaymentCategory, ref: string) => `ref:${category}:${ref.toUpperCase()}`;

/** No two non-rejected daily payments of the same project vehicle and driver may cover the same day. */
async function assertNoDailyOverlap(tvId: string, driver: string, from: string, to: string, exceptId?: string) {
  const clash: any = await SettlementPayment.findOne({
    trackingVehicle: tvId, driver, category: "DAILY", status: { $ne: "REJECTED" }, fromDate: { $lte: to }, toDate: { $gte: from }, ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).select("paymentNumber fromDate toDate").lean();
  if (clash) throw new AppError(`A daily payment (${clash.paymentNumber}, ${clash.fromDate} to ${clash.toDate}) already covers part of this period`, 409);
}

export type EntryRole = "RBP" | "RSA";
export const ENTRY_ROLES: EntryRole[] = ["RBP", "RSA"];
/** Where each entry role opens the shared Driver Payments module (used in notification links). */
export const paymentsHome = (role: unknown) => (role === "RSA" ? "/rsa/driver-payments" : "/rbp/payments");

/**
 * Short-lived named lock (one document per key, unique _id). Serialises the "check for an overlapping / existing payment, then
 * create it" sequence across concurrent requests, so two simultaneous submissions (retries, two users, RBP and RSA at once) cannot
 * both pass the duplicate checks. A lock older than 30 s is treated as abandoned (crashed request) and taken over.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = mongoose.connection.collection<{ _id: string; at: Date }>("settlementlocks");
  const deadline = Date.now() + 8000;
  for (;;) {
    const now = new Date();
    try {
      await locks.insertOne({ _id: key, at: now });
      break;
    } catch (e) {
      if (!isDup(e)) throw e;
      const stale = await locks.findOneAndUpdate({ _id: key, at: { $lt: new Date(now.getTime() - 30_000) } }, { $set: { at: now } });
      if (stale) break;
      if (Date.now() > deadline) throw new AppError("Another submission for this vehicle is being saved; please retry in a moment", 409);
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
    }
  }
  try {
    return await fn();
  } finally {
    await locks.deleteOne({ _id: key });
  }
}

export async function submitSettlement(category: PaymentCategory, tvId: string, input: unknown, username: string, role: EntryRole | Date = "RBP", now = new Date()) {
  if (role instanceof Date) [now, role] = [role, "RBP"]; // older call shape (username, now)
  if (category !== "DAILY" && category !== "FINAL") throw new AppError("Unknown payment category", 400);
  if (!ENTRY_ROLES.includes(role)) throw new AppError("Only RBP or RSA can enter driver payments", 403);
  const entryRole = role;
  const { ctx, camp, refs } = await snapshotRefs(tvId);
  const built = category === "DAILY" ? buildDaily(input, ctx.projectType, camp) : buildFinal(input, camp);
  const same: any = await SettlementPayment.findOne({ idempotencyKey: built.key }).lean();
  if (same) {
    if (String(same.trackingVehicle) !== tvId || same.category !== category) throw new AppError("This submission key was already used", 409);
    return { payment: await getSettlement(String(same._id)), replay: true };
  }
  const finalLock = category === "FINAL" ? `${refs.allotment}:${refs.driver}` : undefined;
  let saved: any;
  try {
    saved = await withLock(`${category}:${tvId}:${refs.driver}`, async () => {
    const again: any = await SettlementPayment.findOne({ idempotencyKey: built.key }).lean(); // a retry that waited for the lock
    if (again) return { replayOf: again };
    if (category === "DAILY") await assertNoDailyOverlap(tvId, refs.driver, built.fromDate, built.toDate);
    else {
      const dup: any = await SettlementPayment.findOne({ finalLock }).select("paymentNumber status").lean();
      if (dup) throw new AppError(`A final settlement (${dup.paymentNumber}, ${dup.status.toLowerCase()}) already exists for this driver on this vehicle`, 409);
    }
    return inTxn(async (session) => {
      const [doc]: any[] = await SettlementPayment.create([{
        ...refs, paymentNumber: await nextNumber(category, now, session), category, status: "PENDING", version: 1,
        jsNumber: category === "FINAL" ? (built.data as any).jsNumber ?? camp.jsNumber : camp.jsNumber,
        fromDate: built.fromDate, toDate: built.toDate, amount: built.amount, data: built.data, submittedBy: username, submittedRole: entryRole, submittedAt: now, idempotencyKey: built.key, finalLock,
      }], { session });
      await logEvent(doc, "SUBMITTED", username, entryRole, { snapshot: built.data }, session);
      return doc.toObject();
    });
    });
    if (saved.replayOf) return { payment: await getSettlement(String(saved.replayOf._id)), replay: true };
  } catch (e) {
    if (!isDup(e)) throw e;
    const won: any = await SettlementPayment.findOne({ idempotencyKey: built.key }).lean();
    if (won) return { payment: await getSettlement(String(won._id)), replay: true };
    throw new AppError("A final settlement already exists for this driver on this vehicle", 409);
  }
  await notifyRole(APPROVER[category], {
    type: "PAYMENT_SUBMITTED", title: `${CATEGORY_LABEL[category]} submitted`, message: `${saved.paymentNumber} · ${saved.vehicleNo} · ${saved.driverName} · ₹${saved.amount}`,
    link: APPROVER[category] === "RSO" ? "/rso" : "/rsom/payments", meta: { payment: String(saved._id) }, dedupeKey: `pay:${saved._id}:v1:submitted`,
  });
  return { payment: await getSettlement(String(saved._id)), replay: false };
}

/** RBP corrects a rejected entry: a new version is created (the old one stays in the history) and it goes back for approval. */
export async function resubmitSettlement(id: string, input: unknown, username: string, comment: unknown, role: EntryRole | Date = "RBP", now = new Date()) {
  if (role instanceof Date) [now, role] = [role, "RBP"];
  if (!ENTRY_ROLES.includes(role)) throw new AppError("Only RBP or RSA can correct driver payments", 403);
  const entryRole = role;
  if (!validId(id)) throw new AppError("Invalid payment id", 400);
  const p: any = await SettlementPayment.findById(id).lean();
  if (!p) throw new AppError("Payment not found", 404);
  if (p.status !== "REJECTED") throw new AppError("Only a rejected payment can be corrected and resubmitted", 409);
  const note = typeof comment === "string" ? comment.trim() : "";
  if (note.length > 500 || (note && !SAFE_TEXT.test(note))) throw new AppError("Resubmission comment is invalid (max 500 characters)", 400);
  const { ctx, camp } = await snapshotRefs(String(p.trackingVehicle));
  if (String(ctx._raw.driver) !== String(p.driver) || String(ctx._raw.allotment) !== String(p.allotment))
    throw new AppError("The driver or allotment of this project vehicle has changed since this entry; create a new entry instead", 409);
  const body = { ...(input && typeof input === "object" ? input : {}), idempotencyKey: `resubmit-${id}-${p.version + 1}` };
  const built = p.category === "DAILY" ? buildDaily(body, p.projectType, camp, { fromDate: p.fromDate, toDate: p.toDate }) : buildFinal(body, camp);
  let upd: any;
  try {
    upd = await withLock(`${p.category}:${p.trackingVehicle}:${p.driver}`, async () => {
    if (p.category === "DAILY") await assertNoDailyOverlap(String(p.trackingVehicle), String(p.driver), built.fromDate, built.toDate, id);
    return inTxn(async (session) => {
      const u: any = await SettlementPayment.findOneAndUpdate(
        { _id: id, status: "REJECTED", version: p.version },
        {
          $set: { status: "PENDING", version: p.version + 1, data: built.data, amount: built.amount, fromDate: built.fromDate, toDate: built.toDate, submittedBy: username, submittedRole: entryRole, submittedAt: now, ...(p.category === "FINAL" ? { finalLock: `${p.allotment}:${p.driver}` } : {}) },
          $unset: { reviewedBy: 1, reviewedRole: 1, reviewedAt: 1, rejectionReason: 1 },
        },
        { returnDocument: "after", session },
      ).lean();
      if (!u) throw new AppError("This payment was just changed by someone else; refresh and retry", 409);
      await logEvent(u, "RESUBMITTED", username, entryRole, { fromStatus: "REJECTED", comment: note || undefined, snapshot: built.data }, session);
      return u;
    });
    });
  } catch (e) {
    if (isDup(e)) throw new AppError("Another final settlement for this driver on this vehicle was submitted meanwhile", 409);
    throw e;
  }
  await notifyRole(APPROVER[p.category as PaymentCategory], {
    type: "PAYMENT_SUBMITTED", title: `${CATEGORY_LABEL[p.category as PaymentCategory]} resubmitted`, message: `${upd.paymentNumber} (v${upd.version}) · ₹${upd.amount}`,
    link: p.category === "FINAL" ? "/rso" : "/rsom/payments", meta: { payment: id }, dedupeKey: `pay:${id}:v${upd.version}:submitted`,
  });
  return getSettlement(id);
}

// ------------------------------------------------------------------------------------------------ approve / reject

export async function reviewSettlement(id: string, decision: "APPROVE" | "REJECT", user: { username: string; role: RoleKey }, input: { reason?: unknown; comment?: unknown; version?: unknown }, now = new Date()) {
  if (!validId(id)) throw new AppError("Invalid payment id", 400);
  const p: any = await SettlementPayment.findById(id).lean();
  if (!p) throw new AppError("Payment not found", 404);
  if (APPROVER[p.category as PaymentCategory] !== user.role)
    throw new AppError(`${CATEGORY_LABEL[p.category as PaymentCategory]} entries are approved by ${APPROVER[p.category as PaymentCategory]} only`, 403);
  if (p.status !== "PENDING") throw new AppError(`This payment is already ${p.status.toLowerCase()}`, 409);
  if (input.version !== undefined && Number(input.version) !== p.version) throw new AppError("A newer version of this payment was submitted; refresh before deciding", 409);
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const reason = text(input.reason);
  const comment = text(input.comment);
  if (decision === "REJECT" && reason.length < 3) throw new AppError("A rejection reason is required", 400);
  for (const t of [reason, comment]) if (t.length > 500 || (t && !SAFE_TEXT.test(t))) throw new AppError("Comment is invalid (max 500 characters)", 400);
  const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const upd: any = await inTxn(async (session) => {
    const u: any = await SettlementPayment.findOneAndUpdate(
      { _id: id, status: "PENDING", version: p.version },
      {
        $set: { status, reviewedBy: user.username, reviewedRole: user.role, reviewedAt: now, ...(decision === "REJECT" ? { rejectionReason: reason } : {}) },
        ...(decision === "REJECT" ? { $unset: { finalLock: 1 } } : {}), // a rejected final no longer blocks a corrected or new one
      },
      { returnDocument: "after", session },
    ).lean();
    if (!u) throw new AppError("This payment was just decided by someone else; refresh to see its status", 409);
    await logEvent(u, status, user.username, user.role, { fromStatus: "PENDING", comment: (decision === "REJECT" ? reason : comment) || undefined }, session);
    return u;
  });
  await notifyUsername(p.submittedBy, {
    type: decision === "APPROVE" ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED", title: `${upd.paymentNumber} ${status.toLowerCase()}`,
    message: decision === "APPROVE" ? `Approved by ${user.username} (${user.role})` : `Rejected by ${user.username}: ${reason}`,
    link: paymentsHome(p.submittedRole), meta: { payment: id }, dedupeKey: `pay:${id}:v${upd.version}:${status}`,
  });
  if (decision === "APPROVE" && upd.category === "FINAL") await ensureDseNumber(id); // DSE No. is fixed at the moment RSO accounts it
  if (decision === "APPROVE")
    await notifyRole("RSA", { type: "PAYMENT_APPROVED", title: `${CATEGORY_LABEL[upd.category as PaymentCategory]} approved`, message: `${upd.paymentNumber} · ₹${upd.amount} is ready for payment`, link: "/rsa/driver-payments", meta: { payment: id }, dedupeKey: `pay:${id}:v${upd.version}:rsa` });
  return getSettlement(id);
}

/** DSE No.: a unique sequential number from the database counter, assigned once (at RSO approval, or here for older approvals). */
export async function ensureDseNumber(id: string): Promise<number> {
  const cur: any = await SettlementPayment.findById(id).select("dseNumber").lean();
  if (cur?.dseNumber) return cur.dseNumber;
  const c: any = await Counter.findOneAndUpdate({ _id: "settlement:dseNumber" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }).lean();
  const set: any = await SettlementPayment.findOneAndUpdate({ _id: id, dseNumber: { $exists: false } }, { $set: { dseNumber: c.seq } }, { returnDocument: "after" }).lean();
  if (set) return set.dseNumber;
  return ((await SettlementPayment.findById(id).select("dseNumber").lean()) as any).dseNumber; // a parallel request assigned it first
}

// ------------------------------------------------------------------------------------------------ RSA: export + completion

/** Approved (not yet completed) entries of both categories, for the accounts Excel. Each export is recorded on every row. */
export async function approvedForExport(q: { category?: string; from?: string; to?: string }, username: string) {
  const filter: any = { status: "APPROVED" };
  if (q.category === "DAILY" || q.category === "FINAL") filter.category = q.category;
  if (q.from && YMD.test(q.from)) filter.toDate = { $gte: q.from };
  if (q.to && YMD.test(q.to)) filter.fromDate = { $lte: q.to };
  const rows: any[] = await SettlementPayment.find(filter).sort({ category: 1, reviewedAt: 1 }).lean();
  const now = new Date();
  for (const r of rows) {
    await SettlementPayment.updateOne({ _id: r._id, status: "APPROVED" }, { $set: { exportedAt: now }, $inc: { exportCount: 1 } });
    await logEvent(r, "EXPORTED", username, "RSA");
  }
  return rows;
}

export interface CompletionInput { referenceNumber?: unknown; referenceDate?: unknown; paymentDate?: unknown; paymentMode?: unknown; bankName?: unknown; transactionDetails?: unknown; remarks?: unknown }

/**
 * The payment Entry popup (RSA, on an approved payment): Payment Mode (Cash / Cheque / DD / ePayment), Payment Date, Bank Name,
 * Reference Number (mandatory, never blank) and Reference Date. Bank is required except for Cash. Transaction details and remarks
 * remain optional extras. The approved amount and category are never taken from the input.
 */
export function validateCompletion(b: CompletionInput, approvedAt: Date | null, now = new Date()) {
  const errors: string[] = [];
  const text = (v: unknown, label: string, max: number, required: boolean) => {
    const t = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
    if (!t) return (required && errors.push(`${label} is required`), "");
    if (t.length > max) errors.push(`${label} is too long (max ${max})`);
    else if (!SAFE_TEXT.test(t)) errors.push(`${label} contains invalid characters`);
    return t;
  };
  const referenceNumber = text(b.referenceNumber, "Payment reference number", 60, true);
  if (referenceNumber && !/^[A-Za-z0-9/_-]+$/.test(referenceNumber)) errors.push("Payment reference number may contain letters, digits, / - _ only");
  const paymentDate = typeof b.paymentDate === "string" ? b.paymentDate.trim() : "";
  if (!YMD.test(paymentDate) || Number.isNaN(Date.parse(paymentDate))) errors.push("Payment date must be a valid date");
  else {
    const todayIst = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    if (paymentDate > todayIst) errors.push("Payment date cannot be in the future");
    if (approvedAt && paymentDate < new Date(approvedAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)) errors.push("Payment date cannot be before the approval date");
  }
  const paymentMode = typeof b.paymentMode === "string" && (ENTRY_PAYMENT_MODES as readonly string[]).includes(b.paymentMode)
    ? b.paymentMode
    : (errors.push(`Payment mode is required (${ENTRY_PAYMENT_MODES.map((m) => PAYMENT_MODE_LABEL[m]).join(", ")})`), "");
  const bankName = text(b.bankName, "Bank name", 120, paymentMode !== "CASH");
  const transactionDetails = text(b.transactionDetails, "Transaction details", 300, false);
  const remarks = text(b.remarks, "Remarks", 500, false);
  let referenceDate = "";
  if (typeof b.referenceDate === "string" && b.referenceDate.trim()) {
    referenceDate = b.referenceDate.trim();
    if (!YMD.test(referenceDate) || Number.isNaN(Date.parse(referenceDate))) errors.push("Reference date must be a valid date");
    else if (referenceDate > new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)) errors.push("Reference date cannot be in the future");
  }
  return { errors, data: { referenceNumber, referenceDate, paymentDate, paymentMode, bankName, transactionDetails, remarks } };
}

/** RSA records the accounts team's payment reference: APPROVED -> COMPLETED. The entry is kept; it moves to the completed table. */
export async function completeSettlement(id: string, input: CompletionInput, username: string, now = new Date()) {
  if (!validId(id)) throw new AppError("Invalid payment id", 400);
  const p: any = await SettlementPayment.findById(id).lean();
  if (!p) throw new AppError("Payment not found", 404);
  if (p.status === "COMPLETED") throw new AppError("This payment is already marked completed", 409);
  if (p.status !== "APPROVED") throw new AppError("Only an approved payment can be marked completed", 409);
  const v = validateCompletion(input ?? {}, p.reviewedAt ?? null, now);
  if (v.errors.length) throw new AppError(v.errors.join("; "), 400);
  // The reference is the one accounts returned: it may be recorded on one payment of a category only (its own entry's reference
  // is fine). Checked under a lock on the reference, so two RSA users cannot record the same one at the same moment.
  await withLock(refLock(p.category, v.data.referenceNumber), async () => {
  await assertReferenceFree(p.category, v.data.referenceNumber, p._id);
  await inTxn(async (session) => {
    const u: any = await SettlementPayment.findOneAndUpdate(
      { _id: id, status: "APPROVED" },
      { $set: { status: "COMPLETED", completion: {
        referenceNumber: v.data.referenceNumber, referenceDate: v.data.referenceDate || undefined, paymentDate: v.data.paymentDate, paymentMode: v.data.paymentMode, bankName: v.data.bankName || undefined,
        ...(v.data.transactionDetails ? { transactionDetails: seal(v.data.transactionDetails), transactionMasked: maskTail(v.data.transactionDetails) ?? undefined } : {}), remarks: v.data.remarks || undefined, completedBy: username, completedAt: now,
      } } },
      { returnDocument: "after", session },
    ).lean();
    if (!u) throw new AppError("This payment was just changed by someone else; refresh to see its status", 409);
    await logEvent(u, "COMPLETED", username, "RSA", { fromStatus: "APPROVED", comment: `Ref ${v.data.referenceNumber} · ${PAYMENT_MODE_LABEL[v.data.paymentMode] ?? v.data.paymentMode} · ${v.data.paymentDate}` }, session);
  });
  });
  await notifyUsername(p.submittedBy, { type: "PAYMENT_COMPLETED", title: `${p.paymentNumber} paid`, message: `Payment reference ${v.data.referenceNumber} on ${v.data.paymentDate}`, link: paymentsHome(p.submittedRole), meta: { payment: id }, dedupeKey: `pay:${id}:completed` });
  return getSettlement(id);
}

// ------------------------------------------------------------------------------------------------ re-exports for the RBP side panels

export { listEligibleProjects, viewBudget, viewDriver, checkAdvanceEligibility, type EligibleQuery };
export const settlementOptions = () => ({
  dailyExpenseOptions: rsaOptions().expenseOptions,
  finalExpenseCategories: FINAL_EXPENSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, descriptionRequired: c.key === "OTHERS" })),
  deductions: Object.entries(DEDUCTION_LABELS).map(([key, label]) => ({ key, label })), paymentModes: ENTRY_PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABEL[m] })),
});
