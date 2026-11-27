/* eslint-disable @typescript-eslint/no-explicit-any */
import { asVertical } from "../utils/vertical.js";
import mongoose from "mongoose";
import { Budget, BudgetVersion } from "../models/Budget.js";
import { BudgetEvent } from "../models/Approval.js";
import { Driver } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { Counter, RsaPayment } from "../models/RsaPayment.js";
import { SettlementPayment } from "../models/SettlementPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { Vehicle } from "../models/Vehicle.js";
import { calculateAdvance, isValidWorkingDays, MAX_WORKING_DAYS } from "../utils/advance.js";
import { AppError } from "../utils/AppError.js";
import { financialYear } from "../utils/numbers.js";
import { calculatePayable, rupees, validatePaymentInput } from "../utils/rsaPayment.js";
import { maskAccount } from "../validators/driverBank.validator.js";
/**
 * RSA (Roadshow Accounts): read-only on every existing record (tracking, budgets, allotments, drivers, advances);
 * the only thing it writes is its own immutable payment entries.
 */
const validId = (id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDup = (e) => e?.code === 11000;
const oid = (id) => new mongoose.Types.ObjectId(id);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Eligible = the project vehicle's latest allotment (active, or finished but still to be paid) that has a driver, whose budget is
 * Approved by RSOM AND is the current version (no newer unapproved edit). Draft / pending / rejected budgets, vehicle-less and
 * driver-less projects never appear.
 */
function eligiblePipeline(first = []) {
    return [
        ...first,
        { $match: { status: { $in: ["ACTIVE", "RELEASED"] } } },
        { $sort: { createdAt: -1, _id: -1 } },
        { $group: { _id: "$trackingVehicle", a: { $first: "$$ROOT" } } }, // latest allotment of each project vehicle
        { $replaceRoot: { newRoot: "$a" } },
        { $match: { driver: { $type: "objectId" } } },
        { $lookup: { from: Budget.collection.name, localField: "trackingVehicle", foreignField: "vehicle", as: "budget" } },
        { $unwind: "$budget" },
        { $match: { "budget.approvalStatus": "APPROVED", $expr: { $eq: ["$budget.approvedVersion", "$budget.currentVersion"] } } },
        { $lookup: { from: TrackingVehicle.collection.name, localField: "trackingVehicle", foreignField: "_id", as: "tv" } },
        { $unwind: "$tv" },
        { $lookup: { from: TrackingProject.collection.name, localField: "project", foreignField: "_id", as: "proj" } },
        { $unwind: "$proj" },
        {
            $addFields: {
                campaignFromDate: { $cond: [{ $eq: ["$proj.projectType", "ROADSHOW"] }, "$proj.details.startDate", "$proj.details.fromDate"] },
                campaignToDate: { $cond: [{ $eq: ["$proj.projectType", "ROADSHOW"] }, "$proj.details.endDate", "$proj.details.toDate"] },
            },
        },
        {
            $lookup: {
                from: RsaPayment.collection.name, let: { tv: "$trackingVehicle" },
                pipeline: [{ $match: { $expr: { $eq: ["$trackingVehicle", "$$tv"] } } }, { $group: { _id: null, count: { $sum: 1 }, last: { $max: "$entryDateTime" } } }], as: "pay",
            },
        },
        { $addFields: { paymentCount: { $ifNull: [{ $arrayElemAt: ["$pay.count", 0] }, 0] }, lastPaymentAt: { $arrayElemAt: ["$pay.last", 0] } } },
    ];
}
const shape = (r) => ({
    trackingVehicle: String(r.trackingVehicle), allotment: String(r._id), trackupNumber: r.trackupNumber, pifNumber: r.pifNumber,
    projectType: r.proj?.projectType ?? r.projectType, clientName: r.proj?.clientName ?? r.clientName, projectName: r.projectName ?? null, vehicleNo: r.vehicleNo ?? null, requestedVehicleType: r.tv?.vehicleType ?? null,
    driverNumber: r.driverNumber ?? null, driverName: r.driverName ?? null, campaignFromDate: r.campaignFromDate ?? null, campaignToDate: r.campaignToDate ?? null,
    approvedBudgetAmount: r.budget?.total ?? null, budgetVersion: r.budget?.approvedVersion ?? null, vehicleAllottedAt: r.allottedAt ?? null, driverAssignedAt: r.driverAssignedAt ?? null,
    allotmentStatus: r.status, paymentCount: r.paymentCount, paymentStatus: r.paymentCount > 0 ? "ENTERED" : "PENDING", lastPaymentAt: r.lastPaymentAt ?? null,
});
/**
 * Leaves out project vehicles whose current driver already has a Final Settlement there, in any status (a rejected one is corrected
 * and resubmitted, never entered again). The same driver and van on another project vehicle stay eligible. Final picker only.
 */
const withoutSettled = [
    {
        $lookup: {
            from: SettlementPayment.collection.name, let: { tv: "$trackingVehicle", driver: "$driver" },
            pipeline: [{ $match: { category: "FINAL", $expr: { $and: [{ $eq: ["$trackingVehicle", "$$tv"] }, { $eq: ["$driver", "$$driver"] }] } } }, { $limit: 1 }, { $project: { _id: 1 } }],
            as: "settled",
        },
    },
    { $match: { settled: { $size: 0 } } },
];
export async function listEligibleProjects(q) {
    const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
    const page = Math.max(q.page ?? 1, 1);
    const and = [];
    if (q.q?.trim()) {
        const rx = new RegExp(esc(q.q.trim()), "i");
        and.push({ $or: [{ trackupNumber: rx }, { pifNumber: rx }, { "proj.clientName": rx }, { vehicleNo: rx }, { driverName: rx }, { driverNumber: rx }, { billNumber: rx }, { projectName: rx }] });
    }
    if (q.projectType && ["ROADSHOW", "SIGNAGE"].includes(q.projectType))
        and.push({ "proj.projectType": q.projectType });
    if (q.paymentStatus === "ENTERED")
        and.push({ paymentCount: { $gt: 0 } });
    else if (q.paymentStatus === "PENDING")
        and.push({ paymentCount: 0 });
    // date range: the campaign period overlaps [from, to]
    if (q.from && YMD.test(q.from))
        and.push({ campaignToDate: { $gte: q.from } });
    if (q.to && YMD.test(q.to))
        and.push({ campaignFromDate: { $lte: q.to } });
    const pipeline = [
        ...eligiblePipeline(),
        ...(q.forFinal ? withoutSettled : []),
        ...(and.length ? [{ $match: { $and: and } }] : []),
        { $sort: { allottedAt: -1, _id: -1 } },
        { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: "n" }] } },
    ];
    const [r] = await VehicleAllotment.aggregate(pipeline);
    return { items: (r?.items ?? []).map(shape), total: r?.total?.[0]?.n ?? 0, page, limit };
}
/** Why a project vehicle is not eligible (for a precise 409 instead of a bare "not found"). */
async function ineligibleReason(tvId) {
    const budget = await Budget.findOne({ vehicle: tvId }).lean();
    if (!budget || budget.approvalStatus !== "APPROVED" || budget.approvedVersion !== budget.currentVersion)
        return "The latest budget of this project is not approved by RSOM";
    const a = await VehicleAllotment.findOne({ trackingVehicle: tvId, status: { $in: ["ACTIVE", "RELEASED"] } }).sort({ createdAt: -1 }).lean();
    if (!a)
        return "No vehicle is allotted to this project";
    if (!a.driver)
        return "No driver is allotted to this project";
    return "This project is not eligible for payment entry";
}
/** Everything the payment screen shows at the top, read from the real records (never typed by RSA). */
export async function projectContext(tvId, now = new Date()) {
    if (!validId(tvId))
        throw new AppError("Invalid project id", 400);
    if (!(await TrackingVehicle.exists({ _id: tvId })))
        throw new AppError("Project not found", 404);
    const [row] = await VehicleAllotment.aggregate(eligiblePipeline([{ $match: { trackingVehicle: oid(tvId) } }]));
    if (!row)
        throw new AppError(await ineligibleReason(tvId), 409);
    const [veh, drv] = await Promise.all([
        Vehicle.findById(row.vehicle).select("vehicleNo make model type").lean(),
        Driver.findById(row.driver).select("driverNumber driverName driverType mobileNumber").lean(),
    ]);
    return {
        ...shape(row), billNumber: row.billNumber ?? null, paymentFor: row.proj.projectType,
        vehicle: veh ? { _id: String(veh._id), vehicleNo: veh.vehicleNo, make: veh.make ?? null, model: veh.model ?? null, type: veh.type ?? null } : { _id: String(row.vehicle), vehicleNo: row.vehicleNo },
        driver: { _id: String(row.driver), driverNumber: drv?.driverNumber ?? row.driverNumber, driverName: drv?.driverName ?? row.driverName, driverType: drv?.driverType ?? row.driverType ?? null, mobileNumber: drv?.mobileNumber ?? row.driverMobile ?? null },
        entryDateTime: now, // shown, never editable: the saved value is the server time at save
        _raw: { project: String(row.project), vehicle: String(row.vehicle), driver: String(row.driver), allotment: String(row._id) },
    };
}
// ---------------------------------------------------------------- payment number + save
async function nextPaymentNumber(now) {
    const fy = financialYear(now);
    const c = await Counter.findOneAndUpdate({ _id: `rsaPayment:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }).lean();
    return `PAY-${String(c.seq).padStart(6, "0")}/${fy}`;
}
const modeOf = (p) => (p.cashInHand ? "Cash in Hand" : [...new Set((p.dieselEntries ?? []).map((d) => d.mode).filter(Boolean))].join(", ") || "—");
const paymentView = (p) => ({
    _id: String(p._id), paymentNumber: p.paymentNumber, trackingVehicle: String(p.trackingVehicle), trackupNumber: p.trackupNumber, pifNumber: p.pifNumber,
    billNumber: p.billNumber ?? null, clientName: p.clientName ?? null, projectType: p.projectType ?? null, vehicleNo: p.vehicleNo ?? null, driverNumber: p.driverNumber ?? null, driverName: p.driverName ?? null,
    paymentFor: p.paymentFor, campaignFromDate: p.campaignFromDate ?? null, campaignToDate: p.campaignToDate ?? null, entryDateTime: p.entryDateTime, cashInHand: !!p.cashInHand,
    dieselEntries: (p.dieselEntries ?? []).map((d) => ({ amount: d.amount, mode: d.mode ?? null, reference: d.reference ?? null, entryAt: d.entryAt })),
    foodAmount: p.foodAmount ?? 0, salaryAdvance: p.salaryAdvance ?? 0,
    expenses: (p.expenses ?? []).map((e) => ({ optionKey: e.optionKey, optionLabel: e.optionLabel, description: e.description ?? null, amount: e.amount, deduct: !!e.deduct, isDefault: !!e.isDefault })),
    dieselTotal: p.dieselTotal ?? 0, expenseTotal: p.expenseTotal ?? 0, deductTotal: p.deductTotal ?? 0, totalPayable: p.totalPayable, paymentStatus: p.paymentStatus ?? "ENTERED",
    mode: modeOf(p), bankName: null, chequeNo: null, // bank / cheque references are not captured by the entry screen (history columns show an empty value)
    createdBy: p.createdBy, createdAt: p.createdAt,
});
/**
 * Saves one payment entry. The server reads the project, vehicle and driver itself, stamps the time and the RSA user, recalculates
 * the total and generates the payment number. The same idempotency key returns the saved entry instead of a second one.
 */
export async function createPayment(tvId, input, username, now = new Date()) {
    if (!validId(tvId))
        throw new AppError("Invalid project id", 400);
    const v = validatePaymentInput(input);
    if (v.errors.length || !v.data)
        throw new AppError(v.errors.join("; "), 400);
    const ctx = await projectContext(tvId, now);
    if (v.data.paymentFor && v.data.paymentFor !== ctx.projectType)
        throw new AppError(`Payment For must be ${ctx.projectType === "ROADSHOW" ? "Roadshow" : "Signage"} for this project`, 400);
    const same = await RsaPayment.findOne({ trackingVehicle: tvId, idempotencyKey: v.data.idempotencyKey }).lean();
    if (same)
        return { payment: paymentView(same), replay: true };
    const t = calculatePayable(v.data);
    const doc = {
        paymentNumber: await nextPaymentNumber(now), project: ctx._raw.project, trackingVehicle: tvId, allotment: ctx._raw.allotment, trackupNumber: ctx.trackupNumber, pifNumber: ctx.pifNumber,
        billNumber: ctx.billNumber, clientName: ctx.clientName, projectType: ctx.projectType, vehicle: ctx._raw.vehicle, vehicleNo: ctx.vehicle.vehicleNo,
        driver: ctx._raw.driver, driverNumber: ctx.driver.driverNumber, driverName: ctx.driver.driverName, paymentFor: ctx.projectType, campaignFromDate: ctx.campaignFromDate, campaignToDate: ctx.campaignToDate,
        entryDateTime: now, cashInHand: v.data.cashInHand,
        dieselEntries: v.data.diesel.map((d) => ({ amount: rupees(d.amountPaise), mode: d.mode ?? undefined, reference: d.reference ?? undefined, entryAt: now })),
        foodAmount: rupees(v.data.foodPaise), salaryAdvance: rupees(v.data.salaryAdvancePaise),
        expenses: v.data.expenses.map((e) => ({ optionKey: e.optionKey, optionLabel: e.optionLabel, description: e.description ?? undefined, amount: rupees(e.amountPaise), deduct: e.deduct, isDefault: e.isDefault })),
        dieselTotal: rupees(t.dieselP), expenseTotal: rupees(t.expenseAddP), deductTotal: rupees(t.expenseDeductP), totalPayable: rupees(t.totalP),
        paymentStatus: "ENTERED", idempotencyKey: v.data.idempotencyKey, createdBy: username,
    };
    try {
        const saved = await RsaPayment.create(doc);
        return { payment: paymentView(saved.toObject()), replay: false };
    }
    catch (e) {
        if (!isDup(e))
            throw e;
        const won = await RsaPayment.findOne({ trackingVehicle: tvId, idempotencyKey: v.data.idempotencyKey }).lean(); // a simultaneous request with the same key won
        if (!won)
            throw e;
        return { payment: paymentView(won), replay: true };
    }
}
/** Payment history of one project vehicle, latest first, paginated on the server. */
export async function listPayments(tvId, q) {
    if (!validId(tvId))
        throw new AppError("Invalid project id", 400);
    if (!(await TrackingVehicle.exists({ _id: tvId })))
        throw new AppError("Project not found", 404);
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const page = Math.max(q.page ?? 1, 1);
    const [items, total] = await Promise.all([
        RsaPayment.find({ trackingVehicle: tvId }).sort({ entryDateTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        RsaPayment.countDocuments({ trackingVehicle: tvId }),
    ]);
    return { items: items.map(paymentView), total, page, limit };
}
/** Search + filters shared by the history list. All filters combine (AND). Dates are the payment (entry) date in IST. */
export function historyFilter(q) {
    const and = [];
    const t = q.q?.trim();
    if (t) {
        const rx = new RegExp(esc(t), "i");
        and.push({ $or: [
                { paymentNumber: rx }, { trackupNumber: rx }, { pifNumber: rx }, { billNumber: rx }, { clientName: rx }, { vehicleNo: new RegExp(esc(t.replace(/[ -]/g, "")), "i") }, { vehicleNo: rx },
                { driverNumber: rx }, { driverName: rx }, { "expenses.description": rx }, { "dieselEntries.reference": rx },
            ] });
    }
    if (q.paymentFor && ["ROADSHOW", "SIGNAGE"].includes(q.paymentFor))
        and.push({ paymentFor: q.paymentFor });
    if (q.paymentStatus && ["ENTERED"].includes(q.paymentStatus))
        and.push({ paymentStatus: q.paymentStatus });
    if (q.createdBy?.trim())
        and.push({ createdBy: q.createdBy.trim() });
    if ((q.from && YMD.test(q.from)) || (q.to && YMD.test(q.to))) {
        const r = {};
        if (q.from && YMD.test(q.from))
            r.$gte = new Date(`${q.from}T00:00:00+05:30`);
        if (q.to && YMD.test(q.to))
            r.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
        and.push({ entryDateTime: r });
    }
    return and.length ? { $and: and } : {};
}
/** Payment history across every project, latest first, paginated on the server (the browser never receives the full set). */
export async function listAllPayments(q) {
    const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
    const page = Math.max(q.page ?? 1, 1);
    const filter = historyFilter(q);
    const [items, total] = await Promise.all([
        RsaPayment.find(filter).sort({ entryDateTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        RsaPayment.countDocuments(filter),
    ]);
    return { items: items.map(paymentView), total, page, limit };
}
/** Real database totals for the summary cards (amounts summed in paise so currency never drifts). */
export async function paymentSummary(projectType) {
    const type = asVertical(projectType);
    const only = type ? { paymentFor: type } : {};
    const [agg, last, users] = await Promise.all([
        RsaPayment.aggregate([{ $match: only }, { $group: { _id: "$paymentFor", count: { $sum: 1 }, paise: { $sum: { $round: [{ $multiply: ["$totalPayable", 100] }, 0] } } } }]),
        RsaPayment.findOne(only).sort({ entryDateTime: -1 }).select("entryDateTime").lean(),
        RsaPayment.distinct("createdBy"),
    ]);
    const by = (k) => agg.find((x) => x._id === k) ?? { count: 0, paise: 0 };
    const r = by("ROADSHOW");
    const g = by("SIGNAGE");
    return {
        totalEntries: r.count + g.count, totalAmount: rupees(r.paise + g.paise), roadshowCount: r.count, roadshowAmount: rupees(r.paise), signageCount: g.count, signageAmount: rupees(g.paise),
        recentPaymentAt: last?.entryDateTime ?? null, createdByOptions: users.sort(),
    };
}
export async function getPayment(id) {
    if (!validId(id))
        throw new AppError("Invalid payment id", 400);
    const p = await RsaPayment.findById(id).lean();
    if (!p)
        throw new AppError("Payment not found", 404);
    return paymentView(p);
}
// ---------------------------------------------------------------- read-only side panels
/** The approved budget (current approved version) with its version history and RSOM approval details. Read-only. */
export async function viewBudget(tvId) {
    await projectContext(tvId); // eligibility + 404 / 409
    const b = await Budget.findOne({ vehicle: tvId }).lean();
    const [versions, events] = await Promise.all([
        BudgetVersion.find({ budget: b._id }).sort({ version: -1 }).lean(),
        BudgetEvent.find({ budget: b._id }).sort({ createdAt: -1, _id: -1 }).lean(),
    ]);
    const approved = versions.find((x) => x.version === b.approvedVersion);
    const approval = events.find((e) => e.action === "APPROVED" && e.version === b.approvedVersion);
    return {
        budgetNumber: b.budgetNumber, approvedAmount: approved?.total ?? b.total, approvedVersion: b.approvedVersion, currentVersion: b.currentVersion,
        approvedBy: approval?.username ?? b.reviewedBy ?? null, approvedAt: approval?.createdAt ?? b.reviewedAt ?? null, data: approved?.data ?? b.data,
        versions: versions.map((x) => ({ version: x.version, total: x.total, updatedBy: x.updatedBy, createdAt: x.createdAt, approved: x.version === b.approvedVersion })),
        events: events.map((e) => ({ version: e.version, action: e.action, username: e.username, role: e.role, createdAt: e.createdAt })),
    };
}
/** The allocated driver, read-only. The bank account number is always masked here. */
export async function viewDriver(tvId) {
    const ctx = await projectContext(tvId);
    const d = await Driver.findById(ctx._raw.driver).lean();
    if (!d)
        throw new AppError("Driver not found", 404);
    const [advances, allot] = await Promise.all([
        DriverAdvance.find({ driver: d._id }).sort({ submittedAt: -1, _id: -1 }).limit(20).lean(),
        VehicleAllotment.findById(ctx._raw.allotment).lean(),
    ]);
    const av = d.availability ?? null;
    return {
        driverNumber: d.driverNumber, driverName: d.driverName, driverType: d.driverType, mobileNumber: d.mobileNumber, perDaySalary: d.salary ?? 0,
        bank: { accountName: d.accountName ?? null, bankName: d.bankName ?? null, accountNumberMasked: maskAccount(d.accountNumber), ifscCode: d.ifscCode ?? null },
        availability: av ? { status: av.status ?? null, projectName: av.project?.projectName ?? null, trackupNumber: av.project?.trackupNumber ?? null, projectFrom: av.project?.startDate ?? null, projectTo: av.project?.endDate ?? null } : null,
        advances: advances.map((a) => ({ _id: String(a._id), submittedAt: a.submittedAt, workingDays: a.workingDays, perDaySalary: a.perDaySalary, eligibleAdvanceAmount: a.eligibleAdvanceAmount, finalAdvanceAmount: a.finalAdvanceAmount, submittedBy: a.submittedBy })),
        allotment: {
            vehicleNo: allot?.vehicleNo ?? ctx.vehicleNo, trackupNumber: ctx.trackupNumber, allottedAt: allot?.allottedAt ?? null, driverAssignedAt: allot?.driverAssignedAt ?? null,
            driverAssignedBy: allot?.driverAssignedBy ?? null, driverActive: !!allot?.activeDriver, driverReleasedAt: allot?.driverReleasedAt ?? null,
        },
    };
}
/**
 * Check Advance Eligibility: the same calculation RBP's driver advance uses, on the allocated driver's saved salary.
 * Calculation only - nothing is saved and no advance transaction is created.
 */
export async function checkAdvanceEligibility(tvId, workingDaysRaw) {
    const ctx = await projectContext(tvId);
    const n = typeof workingDaysRaw === "string" && /^\d+$/.test(workingDaysRaw.trim()) ? Number(workingDaysRaw.trim()) : NaN;
    if (!isValidWorkingDays(n))
        throw new AppError(`Overall working days must be a whole number between 1 and ${MAX_WORKING_DAYS}`, 400);
    const d = await Driver.findById(ctx._raw.driver).select("driverNumber driverName salary").lean();
    const salary = Number(d?.salary);
    if (!Number.isFinite(salary) || salary <= 0)
        throw new AppError("Driver salary is unavailable; it must be set in Driver Management", 400);
    const c = calculateAdvance(n, salary);
    return { driverNumber: d.driverNumber, driverName: d.driverName, workingDays: c.workingDays, perDaySalary: c.perDaySalary, eligibleAdvanceAmount: c.eligibleAdvanceAmount, halfEligibleAmount: c.calculatedHalfAmount, finalAdvanceAmount: c.finalAdvanceAmount };
}
