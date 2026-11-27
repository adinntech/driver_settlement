/* eslint-disable @typescript-eslint/no-explicit-any */
import { asVertical } from "../utils/vertical.js";
import mongoose from "mongoose";
import { rsaOptions } from "../config/rsaOptions.js";
import { Budget } from "../models/Budget.js";
import { Driver } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { Counter, RsaPayment } from "../models/RsaPayment.js";
import { ENTRY_PAYMENT_MODES, PAYMENT_MODE_LABEL, SettlementPayment, SettlementPaymentEvent } from "../models/SettlementPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { AppError } from "../utils/AppError.js";
import { pendingDriverChange } from "./driverChangeDeduction.js";
import { suspenseFor } from "./paymentDetailsPdf.service.js";
import { financialYear } from "../utils/numbers.js";
import { kmAllowanceOf } from "../utils/kmAllowance.js";
import { parseAmountPaise } from "../utils/rsaPayment.js";
import { maskTail, seal } from "../utils/secureField.js";
import { daysBetween, dailyData, finalData, finalPeriod, recalcMileage, FINAL_EXPENSE_CATEGORIES, DEDUCTION_LABELS, validateDailyInput, validateFinalInput } from "../utils/settlement.js";
import { notifyRole, notifyUsername } from "./notification.service.js";
import { checkAdvanceEligibility, listEligibleProjects, projectContext, viewBudget, viewDriver } from "./rsa.service.js";
/**
 * Daily vehicle payments and final driver settlements.
 * Who does what (enforced here and in the routes):
 *   RBP  submits both categories and resubmits rejected ones
 *   RSOM approves / rejects DAILY only;  RSO approves / rejects FINAL only
 *   RSA  sees pending + approved entries, exports approved ones and records the accounts payment reference (-> COMPLETED)
 */
export const APPROVER = { DAILY: "RSOM", FINAL: "RSO" };
export const CATEGORY_LABEL = { DAILY: "Daily Vehicle Payment", FINAL: "Final Driver Settlement" };
const validId = (id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDup = (e) => e?.code === 11000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Printable text: no angle brackets and no control characters. */
const SAFE_TEXT = { test: (t) => t.length > 0 && ![...t].some((ch) => ch === "<" || ch === ">" || ch < " " || ch === "\u007f") };
// ------------------------------------------------------------------------------------------------ transactions
let txnSupport = null;
/** Transactions need a replica set / sharded cluster. On a standalone server (local dev) the steps run without one; every
 *  state change is still a single conditional (atomic) update, so a lost race can never approve or complete twice. */
async function supportsTxn() {
    if (txnSupport !== null)
        return txnSupport;
    try {
        const h = await mongoose.connection.db.admin().command({ hello: 1 });
        txnSupport = !!h.setName || h.msg === "isdbgrid";
    }
    catch {
        txnSupport = false;
    }
    return txnSupport;
}
export async function inTxn(fn) {
    if (!(await supportsTxn()))
        return fn(undefined);
    const session = await mongoose.startSession();
    try {
        let out;
        await session.withTransaction(async () => {
            out = await fn(session);
        });
        return out;
    }
    finally {
        await session.endSession();
    }
}
async function nextNumber(category, now, session) {
    const fy = financialYear(now);
    const prefix = category === "DAILY" ? "DVP" : "DSE";
    const c = await Counter.findOneAndUpdate({ _id: `settlement:${prefix}:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after", session }).lean();
    return `${prefix}-${String(c.seq).padStart(6, "0")}/${fy}`;
}
async function logEvent(p, action, username, role, extra = {}, session) {
    await SettlementPaymentEvent.create([{
            payment: p._id, paymentNumber: p.paymentNumber, category: p.category, version: p.version, action, fromStatus: extra.fromStatus, toStatus: p.status,
            username, role, comment: extra.comment, amount: p.amount, snapshot: extra.snapshot,
        }], { session });
}
// ------------------------------------------------------------------------------------------------ project context
const campaignOf = (proj) => {
    const d = proj?.details ?? {};
    const roadshow = proj?.projectType === "ROADSHOW";
    const fromDate = (roadshow ? d.startDate : d.fromDate) ?? null;
    const toDate = (roadshow ? d.endDate : d.toDate) ?? null;
    const locs = Array.isArray(d.reportingLocations) ? d.reportingLocations.map((l) => (typeof l === "string" ? l : l?.location ?? l?.name ?? "")).filter(Boolean) : [];
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
export async function settlementContext(tvId) {
    const ctx = await projectContext(tvId);
    const [proj, budget, driver] = await Promise.all([
        TrackingProject.findById(ctx._raw.project).lean(),
        Budget.findOne({ vehicle: tvId }).lean(),
        Driver.findById(ctx._raw.driver).lean(),
    ]);
    const camp = campaignOf(proj);
    const bd = budget?.data ?? {};
    const perDay = (amt, unit, days) => (unit === "PER_CAMPAIGN" && days ? Math.round((Number(amt) / days) * 100) / 100 : Number(amt) || 0);
    const days = Number(bd.numberOfDays) || camp.totalDays || 0;
    const driverChange = await pendingDriverChange(ctx._raw.driver);
    const [advances, dailyAdvances, existingFinal, rsaEntries, suspense] = await Promise.all([
        DriverAdvance.find({ driver: ctx._raw.driver, submittedAt: { $gte: new Date(`${camp.fromDate ?? "1970-01-01"}T00:00:00+05:30`) } }).select("finalAdvanceAmount workingDays submittedAt submittedBy").sort({ submittedAt: 1 }).lean(),
        SettlementPayment.find({ trackingVehicle: tvId, driver: ctx._raw.driver, category: "DAILY", status: { $ne: "REJECTED" } }).select("paymentNumber status fromDate toDate amount submittedAt completion data.salaryAdvance data.dieselTotal data.foodAmount data.cashInHand data.dieselEntries").sort({ fromDate: 1 }).lean(),
        SettlementPayment.findOne({ category: "FINAL", trackingVehicle: tvId, driver: ctx._raw.driver }).sort({ submittedAt: -1 }).select("paymentNumber status").lean(),
        RsaPayment.find({ trackingVehicle: tvId }).select("paymentNumber entryDateTime totalPayable cashInHand dieselEntries").sort({ entryDateTime: -1 }).limit(100).lean(),
        suspenseFor(tvId, ctx._raw.driver, camp.fromDate),
    ]);
    return {
        trackingVehicle: ctx.trackingVehicle, trackupNumber: ctx.trackupNumber, pifNumber: ctx.pifNumber, clientName: ctx.clientName, projectType: ctx.projectType,
        vehicleNo: ctx.vehicle.vehicleNo, driverNumber: ctx.driver.driverNumber, driverName: ctx.driver.driverName, approvedBudgetAmount: ctx.approvedBudgetAmount, budgetVersion: ctx.budgetVersion,
        campaign: camp,
        bank: { accountName: driver?.accountName ?? null, bankName: driver?.bankName ?? null, ifscCode: driver?.ifscCode ?? null, accountMasked: maskTail(driver?.accountNumber) },
        existingFinal: existingFinal ? { paymentNumber: existingFinal.paymentNumber, status: existingFinal.status } : null,
        suspense: { rows: suspense.rows, total: suspense.total }, // every line behind prefill.suspenseAmount
        // the driver advances and the on-road report (existing payment records of this driver on this vehicle)
        advances: advances.map((a) => ({ source: "Driver Advance", date: a.submittedAt, amount: a.finalAdvanceAmount ?? 0, note: `${a.workingDays} working days · ${a.submittedBy}` })),
        // previous payments of this project vehicle: daily settlements (any status but rejected) and the RSA payment entries
        previousPayments: [
            ...dailyAdvances.map((p) => ({
                source: "DAILY", paymentNumber: p.paymentNumber, status: p.status, date: p.completion?.paymentDate ?? p.fromDate, amount: p.amount,
                mode: (p.completion ? PAYMENT_MODE_LABEL[p.completion.paymentMode] ?? p.completion.paymentMode : null) ?? (p.data?.cashInHand ? "Cash" : ([...new Set((p.data?.dieselEntries ?? []).map((x) => x.mode).filter(Boolean))].join(", ") || "ePayment")),
                bankName: p.completion?.bankName ?? ((p.data?.dieselEntries ?? []).map((x) => x.reference).filter(Boolean).join(", ") || null),
                referenceNumber: p.completion?.referenceNumber ?? null,
            })),
            ...rsaEntries.map((p) => ({
                source: "RSA", paymentNumber: p.paymentNumber, status: "ENTERED", date: new Date(new Date(p.entryDateTime).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10), amount: p.totalPayable,
                mode: p.cashInHand ? "Cash" : [...new Set((p.dieselEntries ?? []).map((x) => x.mode).filter(Boolean))].join(", ") || "ePayment",
                bankName: (p.dieselEntries ?? []).map((x) => x.reference).filter(Boolean).join(", ") || null,
            })),
        ].sort((a, b) => String(b.date).localeCompare(String(a.date))),
        dailyPayments: dailyAdvances.map((p) => ({ paymentNumber: p.paymentNumber, status: p.status, fromDate: p.fromDate, toDate: p.toDate, amount: p.amount, salaryAdvance: p.data?.salaryAdvance ?? 0, diesel: p.data?.dieselTotal ?? 0, food: p.data?.foodAmount ?? 0 })),
        prefill: {
            // Signage carries a job sheet no; for RoadShow the trackup no is the JS no
            jsNumber: camp.jsNumber ?? ctx.trackupNumber, location: camp.location, reportingDate: camp.reportingDate,
            estimatedKmPerDay: Number(bd.estimatedKmPerDay) || 0, fixedMileage: Number(bd.mileage) || 0,
            estimatedBudget: budget?.total ?? 0, estimatedKm: Number(bd.totalKm) || (Number(bd.estimatedKmPerDay) || 0) * days,
            estimatedFuel: Number(bd.mileage) ? Math.round((((Number(bd.totalKm) || (Number(bd.estimatedKmPerDay) || 0) * days) / Number(bd.mileage)) * 100)) / 100 : 0,
            perDaySalary: perDay(bd.salaryAmount, bd.salaryUnit, days) || Number(driver?.salary) || 0, perDayFood: perDay(bd.foodAmount, bd.foodUnit, days),
            driverChangeAmount: driverChange.amount, suspenseAmount: suspense.total,
        },
    };
}
// ------------------------------------------------------------------------------------------------ views
const shape = (p) => ({
    _id: String(p._id), paymentNumber: p.paymentNumber, category: p.category, categoryLabel: CATEGORY_LABEL[p.category], status: p.status, version: p.version,
    trackingVehicle: String(p.trackingVehicle), trackupNumber: p.trackupNumber, pifNumber: p.pifNumber ?? null, jsNumber: p.jsNumber ?? null, clientName: p.clientName ?? null, projectType: p.projectType,
    vehicleNo: p.vehicleNo ?? null, driverNumber: p.driverNumber ?? null, driverName: p.driverName ?? null, fromDate: p.fromDate, toDate: p.toDate, amount: p.amount,
    bank: p.bank ? { accountName: p.bank.accountName ?? null, bankName: p.bank.bankName ?? null, ifscCode: p.bank.ifscCode ?? null, accountMasked: p.bank.accountMasked ?? null } : null,
    submittedBy: p.submittedBy, submittedRole: p.submittedRole ?? "RBP", submittedAt: p.submittedAt, reviewedBy: p.reviewedBy ?? null, reviewedRole: p.reviewedRole ?? null, reviewedAt: p.reviewedAt ?? null,
    rejectionReason: p.rejectionReason ?? null, approver: APPROVER[p.category], exportedAt: p.exportedAt ?? null, exportCount: p.exportCount ?? 0,
    completion: p.completion ? { referenceNumber: p.completion.referenceNumber, referenceDate: p.completion.referenceDate ?? null, paymentDate: p.completion.paymentDate, paymentMode: p.completion.paymentMode, bankName: p.completion.bankName ?? null, transactionMasked: p.completion.transactionMasked ?? null, remarks: p.completion.remarks ?? null, completedBy: p.completion.completedBy, completedAt: p.completion.completedAt } : null,
});
export async function getSettlement(id) {
    if (!validId(id))
        throw new AppError("Invalid payment id", 400);
    const p = await SettlementPayment.findById(id).lean();
    if (!p)
        throw new AppError("Payment not found", 404);
    const events = await SettlementPaymentEvent.find({ payment: p._id }).sort({ createdAt: 1, _id: 1 }).lean();
    return {
        ...shape(p), data: p.data,
        history: events.map((e) => ({ action: e.action, version: e.version, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null, username: e.username, role: e.role, comment: e.comment ?? null, amount: e.amount ?? null, createdAt: e.createdAt })),
    };
}
const SORTS = { submittedAt: "submittedAt", amount: "amount", paymentNumber: "paymentNumber", fromDate: "fromDate", status: "status", driverName: "driverName", vehicleNo: "vehicleNo" };
/** Roles whose queue and summary cards are limited to the one category they approve. */
const APPROVER_ONLY = { RSOM: "DAILY" };
/** Common approval queue. Completed payments are listed separately (`status=COMPLETED`). */
export function listFilter(q, role) {
    const and = [];
    const category = role === "RSOM" ? APPROVER_ONLY.RSOM : q.category; // RSOM works on daily payments only, whatever is asked for
    if (category === "DAILY" || category === "FINAL")
        and.push({ category });
    // scope=all: the shared Driver Payments module (RBP and RSA see the same full list, paid entries included: they stay there with
    // "Entry Completed" and also appear in Payment Completed). RSA's accounts queue (no scope) stays pending + approved only.
    const shared = q.scope === "all" && (role === "RBP" || role === "RSA");
    const queue = shared ? ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] : role === "RSA" ? ["PENDING", "APPROVED"] : ["PENDING", "APPROVED", "REJECTED"];
    if (q.status === "COMPLETED")
        and.push({ status: "COMPLETED" });
    else if (q.status && queue.includes(q.status))
        and.push({ status: q.status });
    else
        and.push({ status: { $in: queue } });
    if (q.projectType === "ROADSHOW" || q.projectType === "SIGNAGE")
        and.push({ projectType: q.projectType });
    const t = q.q?.trim();
    if (t) {
        const rx = new RegExp(esc(t), "i");
        and.push({ $or: [{ paymentNumber: rx }, { trackupNumber: rx }, { pifNumber: rx }, { jsNumber: rx }, { clientName: rx }, { vehicleNo: rx }, { driverName: rx }, { driverNumber: rx }, { submittedBy: rx }, { "completion.referenceNumber": rx }] });
    }
    if (q.from && YMD.test(q.from))
        and.push({ toDate: { $gte: q.from } }); // period overlaps [from, to]
    if (q.to && YMD.test(q.to))
        and.push({ fromDate: { $lte: q.to } });
    if (q.approvedOn && YMD.test(q.approvedOn)) { // the IST day of approval (Bulk Entry)
        const start = new Date(`${q.approvedOn}T00:00:00+05:30`);
        if (!Number.isNaN(start.getTime()))
            and.push({ reviewedAt: { $gte: start, $lt: new Date(start.getTime() + 86_400_000) } });
    }
    return { $and: and };
}
export async function listSettlements(q, role) {
    const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
    const page = Math.max(q.page ?? 1, 1);
    const filter = listFilter(q, role);
    const sortKey = SORTS[q.sort ?? ""] ?? "submittedAt";
    const dir = q.dir === "asc" ? 1 : -1;
    const [items, total, counts] = await Promise.all([
        SettlementPayment.find(filter).sort({ [sortKey]: dir, _id: dir }).skip((page - 1) * limit).limit(limit).lean(),
        SettlementPayment.countDocuments(filter),
        SettlementPayment.aggregate([{ $match: { ...(APPROVER_ONLY[role] ? { category: APPROVER_ONLY[role] } : {}), ...(asVertical(q.projectType) ? { projectType: q.projectType } : {}) } }, { $group: { _id: { c: "$category", s: "$status" }, n: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    ]);
    const summary = {};
    for (const c of counts) {
        const k = `${c._id.c}:${c._id.s}`;
        summary[k] = { count: c.n, amount: Math.round(c.amount * 100) / 100 };
    }
    return { items: items.map(shape), total, page, limit, summary };
}
// ------------------------------------------------------------------------------------------------ submit / resubmit
async function snapshotRefs(tvId) {
    const ctx = await projectContext(tvId);
    const [proj, budget, driver] = await Promise.all([
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
function buildDaily(input, projectType, camp, previous) {
    const v = validateDailyInput(input, { campaignFrom: camp.fromDate, campaignTo: camp.toDate, previous });
    if (v.errors.length || !v.data)
        throw new AppError(v.errors.join("; "), 400);
    if (v.data.paymentFor && v.data.paymentFor !== projectType)
        throw new AppError(`Payment For must be ${projectType === "ROADSHOW" ? "RoadShow" : "Signage"} for this project`, 400);
    const data = dailyData({ ...v.data, paymentFor: (v.data.paymentFor ?? projectType) });
    return { data, key: v.data.idempotencyKey, fromDate: v.data.fromDate, toDate: v.data.toDate, amount: data.totalPayable };
}
function buildFinal(input, camp) {
    if (!camp.fromDate || !camp.toDate)
        throw new AppError("The campaign period of this project is not set", 409);
    const p = finalPeriod(input, { fromDate: camp.fromDate, toDate: camp.toDate, totalDays: camp.totalDays });
    if (p.errors.length)
        throw new AppError(p.errors.join("; "), 400);
    const { fromDate, toDate, totalDays, days } = p.period;
    // on-road days and Sundays fit inside the campaign calendar. Reporting Date is read-only: the project's, never the browser's.
    const v = validateFinalInput({ ...(input && typeof input === "object" ? input : {}), reportingDate: undefined }, { totalDays: days });
    if (v.errors.length || !v.data)
        throw new AppError(v.errors.join("; "), 400);
    v.data.reportingDate = camp.reportingDate ?? camp.fromDate;
    const data = finalData(v.data, { fromDate, toDate, totalDays, km: camp.km }); // the KM allowance stays the project's
    return { data, key: v.data.idempotencyKey, fromDate, toDate, amount: data.netAmount };
}
/**
 * A payment reference identifies one payment of a category: it may not be recorded on another record of that category.
 * Compared without case ("utr1" = "UTR1"). Callers hold `refLock(category, ref)` so two simultaneous saves cannot both pass.
 */
async function assertReferenceFree(category, ref, exceptId) {
    const rx = new RegExp(`^${esc(ref)}$`, "i");
    const clash = await SettlementPayment.findOne({ category, "completion.referenceNumber": rx, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select("paymentNumber").lean();
    if (clash)
        throw new AppError(`Reference number ${ref} is already recorded on ${clash.paymentNumber}`, 409);
}
const refLock = (category, ref) => `ref:${category}:${ref.toUpperCase()}`;
/** No two non-rejected daily payments of the same project vehicle and driver may cover the same day. */
async function assertNoDailyOverlap(tvId, driver, from, to, exceptId) {
    const clash = await SettlementPayment.findOne({
        trackingVehicle: tvId, driver, category: "DAILY", status: { $ne: "REJECTED" }, fromDate: { $lte: to }, toDate: { $gte: from }, ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    }).select("paymentNumber fromDate toDate").lean();
    if (clash)
        throw new AppError(`A daily payment (${clash.paymentNumber}, ${clash.fromDate} to ${clash.toDate}) already covers part of this period`, 409);
}
export const ENTRY_ROLES = ["RBP", "RSA"];
/** Where each entry role opens the shared Driver Payments module (used in notification links). */
export const paymentsHome = (role) => (role === "RSA" ? "/rsa/driver-payments" : "/rbp/payments");
/**
 * Short-lived named lock (one document per key, unique _id). Serialises the "check for an overlapping / existing payment, then
 * create it" sequence across concurrent requests, so two simultaneous submissions (retries, two users, RBP and RSA at once) cannot
 * both pass the duplicate checks. A lock older than 30 s is treated as abandoned (crashed request) and taken over.
 */
export async function withLock(key, fn) {
    const locks = mongoose.connection.collection("settlementlocks");
    const deadline = Date.now() + 8000;
    for (;;) {
        const now = new Date();
        try {
            await locks.insertOne({ _id: key, at: now });
            break;
        }
        catch (e) {
            if (!isDup(e))
                throw e;
            const stale = await locks.findOneAndUpdate({ _id: key, at: { $lt: new Date(now.getTime() - 30_000) } }, { $set: { at: now } });
            if (stale)
                break;
            if (Date.now() > deadline)
                throw new AppError("Another submission for this vehicle is being saved; please retry in a moment", 409);
            await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
        }
    }
    try {
        return await fn();
    }
    finally {
        await locks.deleteOne({ _id: key });
    }
}
/**
 * Previous Salary Deduction carries the driver-change deductions this driver still owes. The figure the form was built on must still
 * be current, the deduction may not be below it (more can be added by hand), and the events recovered are recorded with the entry.
 */
async function applyDriverChange(data, input, driverId, exceptPaymentId) {
    const due = await pendingDriverChange(driverId, exceptPaymentId);
    const seen = Number(input?.driverChangeAmount ?? 0);
    if (Math.round(seen * 100) !== Math.round(due.amount * 100))
        throw new AppError(`The driver change deduction for this driver is now ${due.amount}; reload the form and check Previous Salary Deduction`, 409);
    if (Math.round(data.deductions.previousSalary * 100) < Math.round(due.amount * 100))
        throw new AppError(`Previous Salary Deduction must be at least ${due.amount} (driver change deduction)`, 400);
    data.driverChangeAmount = due.amount;
    data.driverChangeEvents = due.events;
}
/**
 * The Suspense Amount is the server's: the eligible Daily Payments (and advances) of this driver on this project vehicle, now.
 * The figure the form was built on must equal it, so a settlement can neither leave suspense out nor be saved on stale records.
 */
async function applySuspense(data, trackingVehicle, driver, campaignFrom) {
    const { total } = await suspenseFor(trackingVehicle, driver, campaignFrom);
    if (Math.round(data.suspenseAmount * 100) !== Math.round(total * 100))
        throw new AppError(`The Suspense Amount for this driver and vehicle is now ${total}; reload the form`, 409);
}
/** Finals of one driver are saved one at a time (on any project), so two cannot recover the same driver change. */
const payLock = (category, tvId, driver) => (category === "FINAL" ? `FINAL:${driver}` : `DAILY:${tvId}:${driver}`);
export async function submitSettlement(category, tvId, input, username, role = "RBP", now = new Date()) {
    if (role instanceof Date)
        [now, role] = [role, "RBP"]; // older call shape (username, now)
    if (category !== "DAILY" && category !== "FINAL")
        throw new AppError("Unknown payment category", 400);
    if (!ENTRY_ROLES.includes(role))
        throw new AppError("Only RBP or RSA can enter driver payments", 403);
    const entryRole = role;
    const { ctx, camp, refs } = await snapshotRefs(tvId);
    const built = category === "DAILY" ? buildDaily(input, ctx.projectType, camp) : buildFinal(input, camp);
    const same = await SettlementPayment.findOne({ idempotencyKey: built.key }).lean();
    if (same) {
        if (String(same.trackingVehicle) !== tvId || same.category !== category)
            throw new AppError("This submission key was already used", 409);
        return { payment: await getSettlement(String(same._id)), replay: true };
    }
    const finalLock = category === "FINAL" ? `${refs.allotment}:${refs.driver}` : undefined;
    let saved;
    try {
        saved = await withLock(payLock(category, tvId, refs.driver), async () => {
            const again = await SettlementPayment.findOne({ idempotencyKey: built.key }).lean(); // a retry that waited for the lock
            if (again)
                return { replayOf: again };
            if (category === "DAILY")
                await assertNoDailyOverlap(tvId, refs.driver, built.fromDate, built.toDate);
            else {
                // any status counts, whatever allotment it was raised on: a rejected one is corrected and resubmitted, not entered again
                const dup = await SettlementPayment.findOne({ category: "FINAL", trackingVehicle: tvId, driver: refs.driver }).select("paymentNumber status").lean();
                if (dup)
                    throw new AppError(`A final settlement (${dup.paymentNumber}, ${dup.status.toLowerCase()}) already exists for this driver on this vehicle${dup.status === "REJECTED" ? "; correct and resubmit it" : ""}`, 409);
                await applyDriverChange(built.data, input, refs.driver);
                await applySuspense(built.data, tvId, refs.driver, camp.fromDate);
            }
            return inTxn(async (session) => {
                const [doc] = await SettlementPayment.create([{
                        ...refs, paymentNumber: await nextNumber(category, now, session), category, status: "PENDING", version: 1,
                        jsNumber: category === "FINAL" ? built.data.jsNumber ?? camp.jsNumber : camp.jsNumber,
                        fromDate: built.fromDate, toDate: built.toDate, amount: built.amount, data: built.data, submittedBy: username, submittedRole: entryRole, submittedAt: now, idempotencyKey: built.key, finalLock,
                    }], { session });
                await logEvent(doc, "SUBMITTED", username, entryRole, { snapshot: built.data }, session);
                return doc.toObject();
            });
        });
        if (saved.replayOf)
            return { payment: await getSettlement(String(saved.replayOf._id)), replay: true };
    }
    catch (e) {
        if (!isDup(e))
            throw e;
        const won = await SettlementPayment.findOne({ idempotencyKey: built.key }).lean();
        if (won)
            return { payment: await getSettlement(String(won._id)), replay: true };
        throw new AppError("A final settlement already exists for this driver on this vehicle", 409);
    }
    await notifyRole(APPROVER[category], {
        type: "PAYMENT_SUBMITTED", title: `${CATEGORY_LABEL[category]} submitted`, message: `${saved.paymentNumber} · ${saved.vehicleNo} · ${saved.driverName} · ₹${saved.amount}`,
        link: APPROVER[category] === "RSO" ? "/rso" : "/rsom/payments", meta: { payment: String(saved._id) }, dedupeKey: `pay:${saved._id}:v1:submitted`,
    });
    return { payment: await getSettlement(String(saved._id)), replay: false };
}
/** RBP corrects a rejected entry: a new version is created (the old one stays in the history) and it goes back for approval. */
export async function resubmitSettlement(id, input, username, comment, role = "RBP", now = new Date()) {
    if (role instanceof Date)
        [now, role] = [role, "RBP"];
    if (!ENTRY_ROLES.includes(role))
        throw new AppError("Only RBP or RSA can correct driver payments", 403);
    const entryRole = role;
    if (!validId(id))
        throw new AppError("Invalid payment id", 400);
    const p = await SettlementPayment.findById(id).lean();
    if (!p)
        throw new AppError("Payment not found", 404);
    if (p.status !== "REJECTED")
        throw new AppError("Only a rejected payment can be corrected and resubmitted", 409);
    const note = typeof comment === "string" ? comment.trim() : "";
    if (note.length > 500 || (note && !SAFE_TEXT.test(note)))
        throw new AppError("Resubmission comment is invalid (max 500 characters)", 400);
    const { ctx, camp } = await snapshotRefs(String(p.trackingVehicle));
    if (String(ctx._raw.driver) !== String(p.driver) || String(ctx._raw.allotment) !== String(p.allotment))
        throw new AppError("The driver or allotment of this project vehicle has changed since this entry; create a new entry instead", 409);
    const body = { ...(input && typeof input === "object" ? input : {}), idempotencyKey: `resubmit-${id}-${p.version + 1}` };
    const built = p.category === "DAILY" ? buildDaily(body, p.projectType, camp, { fromDate: p.fromDate, toDate: p.toDate }) : buildFinal(body, camp);
    let upd;
    try {
        upd = await withLock(payLock(p.category, String(p.trackingVehicle), String(p.driver)), async () => {
            if (p.category === "DAILY")
                await assertNoDailyOverlap(String(p.trackingVehicle), String(p.driver), built.fromDate, built.toDate, id);
            else {
                await applyDriverChange(built.data, input, String(p.driver), id);
                await applySuspense(built.data, String(p.trackingVehicle), String(p.driver), camp.fromDate);
            }
            return inTxn(async (session) => {
                const u = await SettlementPayment.findOneAndUpdate({ _id: id, status: "REJECTED", version: p.version }, {
                    $set: { status: "PENDING", version: p.version + 1, data: built.data, amount: built.amount, fromDate: built.fromDate, toDate: built.toDate, submittedBy: username, submittedRole: entryRole, submittedAt: now, ...(p.category === "FINAL" ? { finalLock: `${p.allotment}:${p.driver}` } : {}) },
                    $unset: { reviewedBy: 1, reviewedRole: 1, reviewedAt: 1, rejectionReason: 1 },
                }, { returnDocument: "after", session }).lean();
                if (!u)
                    throw new AppError("This payment was just changed by someone else; refresh and retry", 409);
                await logEvent(u, "RESUBMITTED", username, entryRole, { fromStatus: "REJECTED", comment: note || undefined, snapshot: built.data }, session);
                return u;
            });
        });
    }
    catch (e) {
        if (isDup(e))
            throw new AppError("Another final settlement for this driver on this vehicle was submitted meanwhile", 409);
        throw e;
    }
    await notifyRole(APPROVER[p.category], {
        type: "PAYMENT_SUBMITTED", title: `${CATEGORY_LABEL[p.category]} resubmitted`, message: `${upd.paymentNumber} (v${upd.version}) · ₹${upd.amount}`,
        link: p.category === "FINAL" ? "/rso" : "/rsom/payments", meta: { payment: id }, dedupeKey: `pay:${id}:v${upd.version}:submitted`,
    });
    return getSettlement(id);
}
// ------------------------------------------------------------------------------------------------ approve / reject
export async function reviewSettlement(id, decision, user, input, now = new Date()) {
    if (!validId(id))
        throw new AppError("Invalid payment id", 400);
    const p = await SettlementPayment.findById(id).lean();
    if (!p)
        throw new AppError("Payment not found", 404);
    if (APPROVER[p.category] !== user.role)
        throw new AppError(`${CATEGORY_LABEL[p.category]} entries are approved by ${APPROVER[p.category]} only`, 403);
    if (p.status !== "PENDING")
        throw new AppError(`This payment is already ${p.status.toLowerCase()}`, 409);
    if (input.version !== undefined && Number(input.version) !== p.version)
        throw new AppError("A newer version of this payment was submitted; refresh before deciding", 409);
    const text = (v) => (typeof v === "string" ? v.trim() : "");
    const reason = text(input.reason);
    const comment = text(input.comment);
    if (decision === "REJECT" && reason.length < 3)
        throw new AppError("A rejection reason is required", 400);
    for (const t of [reason, comment])
        if (t.length > 500 || (t && !SAFE_TEXT.test(t)))
            throw new AppError("Comment is invalid (max 500 characters)", 400);
    const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const upd = await inTxn(async (session) => {
        const u = await SettlementPayment.findOneAndUpdate({ _id: id, status: "PENDING", version: p.version }, {
            $set: { status, reviewedBy: user.username, reviewedRole: user.role, reviewedAt: now, ...(decision === "REJECT" ? { rejectionReason: reason } : {}) },
            ...(decision === "REJECT" ? { $unset: { finalLock: 1 } } : {}), // a rejected final no longer blocks a corrected or new one
        }, { returnDocument: "after", session }).lean();
        if (!u)
            throw new AppError("This payment was just decided by someone else; refresh to see its status", 409);
        await logEvent(u, status, user.username, user.role, { fromStatus: "PENDING", comment: (decision === "REJECT" ? reason : comment) || undefined }, session);
        return u;
    });
    await notifyUsername(p.submittedBy, {
        type: decision === "APPROVE" ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED", title: `${upd.paymentNumber} ${status.toLowerCase()}`,
        message: decision === "APPROVE" ? `Approved by ${user.username} (${user.role})` : `Rejected by ${user.username}: ${reason}`,
        link: paymentsHome(p.submittedRole), meta: { payment: id }, dedupeKey: `pay:${id}:v${upd.version}:${status}`,
    });
    if (decision === "APPROVE" && upd.category === "FINAL")
        await ensureDseNumber(id); // DSE No. is fixed at the moment RSO accounts it
    if (decision === "APPROVE")
        await notifyRole("RSA", { type: "PAYMENT_APPROVED", title: `${CATEGORY_LABEL[upd.category]} approved`, message: `${upd.paymentNumber} · ₹${upd.amount} is ready for payment`, link: "/rsa/driver-payments", meta: { payment: id }, dedupeKey: `pay:${id}:v${upd.version}:rsa` });
    return getSettlement(id);
}
/** DSE No.: a unique sequential number from the database counter, assigned once (at RSO approval, or here for older approvals). */
export async function ensureDseNumber(id) {
    const cur = await SettlementPayment.findById(id).select("dseNumber").lean();
    if (cur?.dseNumber)
        return cur.dseNumber;
    const c = await Counter.findOneAndUpdate({ _id: "settlement:dseNumber" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }).lean();
    const set = await SettlementPayment.findOneAndUpdate({ _id: id, dseNumber: { $exists: false } }, { $set: { dseNumber: c.seq } }, { returnDocument: "after" }).lean();
    if (set)
        return set.dseNumber;
    return (await SettlementPayment.findById(id).select("dseNumber").lean()).dseNumber; // a parallel request assigned it first
}
/** RSO edits the mileage of a pending final settlement. The version moves on, so a decision taken on the old figures is refused. */
export async function editMileage(id, input, user) {
    if (user.role !== "RSO")
        throw new AppError("Only RSO can edit the mileage of a final settlement", 403);
    if (!validId(id))
        throw new AppError("Invalid payment id", 400);
    const p = await SettlementPayment.findById(id).lean();
    if (!p)
        throw new AppError("Payment not found", 404);
    if (p.category !== "FINAL")
        throw new AppError("Mileage applies to final settlements only", 409);
    if (p.status !== "PENDING")
        throw new AppError(`This settlement is already ${p.status.toLowerCase()}; its mileage cannot be changed`, 409);
    if (Number(input?.version) !== p.version)
        throw new AppError("This settlement was changed; refresh before editing", 409);
    const raw = parseAmountPaise(input?.fixedMileage);
    if (raw.error || !raw.paise)
        throw new AppError(`Mileage ${raw.error ?? "must be greater than zero"}`, 400);
    const mileage = raw.paise / 100;
    if (mileage === p.data.fuel.fixedMileage)
        throw new AppError("The mileage is unchanged", 400);
    const data = recalcMileage(p.data, mileage);
    if (data.netAmount < 0)
        throw new AppError("With this mileage the deductions and suspense are more than the gross amount", 400);
    const upd = await SettlementPayment.findOneAndUpdate({ _id: id, status: "PENDING", version: p.version }, { $set: { data, amount: data.netAmount, version: p.version + 1 } }, { returnDocument: "after" }).lean();
    if (!upd)
        throw new AppError("This settlement was just changed by someone else; refresh and retry", 409);
    const comment = `Mileage ${p.data.fuel.fixedMileage} → ${mileage} km/l · Mileage short ${p.data.deductions.mileageShort} → ${data.deductions.mileageShort} · Net ${p.data.netAmount} → ${data.netAmount}`;
    await logEvent(upd, "MILEAGE_EDITED", user.username, user.role, { fromStatus: "PENDING", comment, snapshot: data });
    return getSettlement(id);
}
// ------------------------------------------------------------------------------------------------ RSA: export + completion
/**
 * The rows of an RSA payment export: the same filters as the Driver Payments table (listFilter), every page. Each exported
 * approved row is recorded (it has gone to accounts); rows in any other status are only read.
 */
export async function paymentsForExport(q, username) {
    const rows = await SettlementPayment.find(listFilter({ ...q, scope: "all" }, "RSA")).sort({ category: 1, reviewedAt: 1 }).lean();
    const now = new Date();
    for (const r of rows.filter((x) => x.status === "APPROVED")) {
        await SettlementPayment.updateOne({ _id: r._id, status: "APPROVED" }, { $set: { exportedAt: now }, $inc: { exportCount: 1 } });
        await logEvent(r, "EXPORTED", username, "RSA");
    }
    return rows;
}
/** Export Approved: every approved (not yet completed) daily and final payment, whatever the table is filtered to. */
export const approvedForExport = (username) => paymentsForExport({ status: "APPROVED" }, username);
/**
 * The payment Entry popup (RSA, on an approved payment): Payment Mode (Cash / Cheque / DD / ePayment), Payment Date, Mode of Payment (the paying bank, stored as bankName),
 * Reference Number (mandatory, never blank) and Reference Date. Bank is required except for Cash. Transaction details and remarks
 * remain optional extras. The approved amount and category are never taken from the input.
 */
export function validateCompletion(b, approvedAt, now = new Date()) {
    const errors = [];
    const text = (v, label, max, required) => {
        const t = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
        if (!t)
            return (required && errors.push(`${label} is required`), "");
        if (t.length > max)
            errors.push(`${label} is too long (max ${max})`);
        else if (!SAFE_TEXT.test(t))
            errors.push(`${label} contains invalid characters`);
        return t;
    };
    const referenceNumber = text(b.referenceNumber, "Payment reference number", 60, true);
    if (referenceNumber && !/^[A-Za-z0-9/_-]+$/.test(referenceNumber))
        errors.push("Payment reference number may contain letters, digits, / - _ only");
    const paymentDate = typeof b.paymentDate === "string" ? b.paymentDate.trim() : "";
    if (!YMD.test(paymentDate) || Number.isNaN(Date.parse(paymentDate)))
        errors.push("Payment date must be a valid date");
    else {
        const todayIst = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
        if (paymentDate > todayIst)
            errors.push("Payment date cannot be in the future");
        if (approvedAt && paymentDate < new Date(approvedAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10))
            errors.push("Payment date cannot be before the approval date");
    }
    const paymentMode = typeof b.paymentMode === "string" && ENTRY_PAYMENT_MODES.includes(b.paymentMode)
        ? b.paymentMode
        : (errors.push(`Payment mode is required (${ENTRY_PAYMENT_MODES.map((m) => PAYMENT_MODE_LABEL[m]).join(", ")})`), "");
    const bankName = text(b.bankName, "Mode of Payment", 120, paymentMode !== "CASH");
    const transactionDetails = text(b.transactionDetails, "Transaction details", 300, false);
    const remarks = text(b.remarks, "Remarks", 500, false);
    let referenceDate = "";
    if (typeof b.referenceDate === "string" && b.referenceDate.trim()) {
        referenceDate = b.referenceDate.trim();
        if (!YMD.test(referenceDate) || Number.isNaN(Date.parse(referenceDate)))
            errors.push("Reference date must be a valid date");
        else if (referenceDate > new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10))
            errors.push("Reference date cannot be in the future");
    }
    return { errors, data: { referenceNumber, referenceDate, paymentDate, paymentMode, bankName, transactionDetails, remarks } };
}
/** RSA records the accounts team's payment reference: APPROVED -> COMPLETED. The entry is kept; it moves to the completed table. */
export async function completeSettlement(id, input, username, now = new Date()) {
    if (!validId(id))
        throw new AppError("Invalid payment id", 400);
    const p = await SettlementPayment.findById(id).lean();
    if (!p)
        throw new AppError("Payment not found", 404);
    if (p.status === "COMPLETED")
        throw new AppError("This payment is already marked completed", 409);
    if (p.status !== "APPROVED")
        throw new AppError("Only an approved payment can be marked completed", 409);
    const v = validateCompletion(input ?? {}, p.reviewedAt ?? null, now);
    if (v.errors.length)
        throw new AppError(v.errors.join("; "), 400);
    // The reference is the one accounts returned: it may be recorded on one payment of a category only (its own entry's reference
    // is fine). Checked under a lock on the reference, so two RSA users cannot record the same one at the same moment.
    await withLock(refLock(p.category, v.data.referenceNumber), async () => {
        await assertReferenceFree(p.category, v.data.referenceNumber, p._id);
        await inTxn(async (session) => {
            const u = await SettlementPayment.findOneAndUpdate({ _id: id, status: "APPROVED" }, { $set: { status: "COMPLETED", completion: {
                        referenceNumber: v.data.referenceNumber, referenceDate: v.data.referenceDate || undefined, paymentDate: v.data.paymentDate, paymentMode: v.data.paymentMode, bankName: v.data.bankName || undefined,
                        ...(v.data.transactionDetails ? { transactionDetails: seal(v.data.transactionDetails), transactionMasked: maskTail(v.data.transactionDetails) ?? undefined } : {}), remarks: v.data.remarks || undefined, completedBy: username, completedAt: now,
                    } } }, { returnDocument: "after", session }).lean();
            if (!u)
                throw new AppError("This payment was just changed by someone else; refresh to see its status", 409);
            await logEvent(u, "COMPLETED", username, "RSA", { fromStatus: "APPROVED", comment: `Ref ${v.data.referenceNumber} · ${PAYMENT_MODE_LABEL[v.data.paymentMode] ?? v.data.paymentMode} · ${v.data.paymentDate}` }, session);
        });
    });
    await notifyUsername(p.submittedBy, { type: "PAYMENT_COMPLETED", title: `${p.paymentNumber} paid`, message: `Payment reference ${v.data.referenceNumber} on ${v.data.paymentDate}`, link: paymentsHome(p.submittedRole), meta: { payment: id }, dedupeKey: `pay:${id}:completed` });
    return getSettlement(id);
}
const BULK_MAX = 100;
/**
 * Bulk Entry (RSA): the single completion above, once per payment, so a refused one never stops the others. Every item brings its
 * own mode, date, bank and reference, and the usual one-reference-per-payment rule applies. Nothing is shared between items.
 */
export async function completeBulk(input, username, now = new Date()) {
    const b = input && typeof input === "object" ? input : {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length)
        throw new AppError("Select at least one payment", 400);
    if (items.length > BULK_MAX)
        throw new AppError(`At most ${BULK_MAX} payments can be entered at once`, 400);
    if (!items.every((x) => validId(x?.id)))
        throw new AppError("Invalid payment id", 400);
    if (new Set(items.map((x) => x.id.toLowerCase())).size !== items.length)
        throw new AppError("The same payment was selected twice", 400);
    const results = [];
    for (const item of items) {
        try {
            await completeSettlement(item.id, { referenceNumber: item.referenceNumber, referenceDate: item.referenceDate, paymentDate: item.paymentDate, paymentMode: item.paymentMode, bankName: item.bankName }, username, now);
            results.push({ id: item.id, ok: true, message: "Completed" });
        }
        catch (e) {
            if (!(e instanceof AppError))
                console.error("Bulk entry failed", item.id, e);
            results.push({ id: item.id, ok: false, message: e instanceof AppError ? e.message : "Could not be saved; check Payment Completed before retrying" });
        }
    }
    return { results };
}
// ------------------------------------------------------------------------------------------------ re-exports for the RBP side panels
export { listEligibleProjects, viewBudget, viewDriver, checkAdvanceEligibility };
export const settlementOptions = () => ({
    dailyExpenseOptions: rsaOptions().expenseOptions,
    finalExpenseCategories: FINAL_EXPENSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, descriptionRequired: c.key === "OTHERS" })),
    deductions: Object.entries(DEDUCTION_LABELS).map(([key, label]) => ({ key, label })), paymentModes: ENTRY_PAYMENT_MODES.map((m) => ({ value: m, label: PAYMENT_MODE_LABEL[m] })),
});
