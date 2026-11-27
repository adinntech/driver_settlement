/* eslint-disable @typescript-eslint/no-explicit-any */
import { asVertical } from "../utils/vertical.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { Vehicle, VehicleHistory } from "../models/Vehicle.js";
import { Budget } from "../models/Budget.js";
import { releaseActiveAllotments } from "./allotment.core.js";
import { istNowAt, joinLabel } from "../validators/availability.validator.js";
import { diffVehicle } from "../validators/vehicle.validator.js";
import { kmAllowanceOf } from "../utils/kmAllowance.js";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// ---- history: flat, human-friendly view of the availability block ---------------------------------
export const AV_FIELDS = [
    "availabilityStatus", "availableFrom", "projectType", "projectName", "clientName", "trackupNumber", "pifNumber",
    "projectStart", "projectEnd", "location", "projectRemarks", "expectedRelease", "nextAvailable",
    "issueCategory", "issueDescription", "issueReported", "expectedRepair", "garage", "repairRemarks", "issueStatus",
];
const ISSUE_FIELDS = ["issueCategory", "issueDescription", "issueReported", "expectedRepair", "garage", "repairRemarks", "issueStatus"];
/** Flattens a stored / validated availability block so two of them can be diffed field by field. */
export function flattenAvailability(a) {
    const p = a?.project ?? {};
    const i = a?.issue ?? {};
    return {
        availabilityStatus: a?.status ?? null,
        availableFrom: a?.status === "AVAILABLE" ? joinLabel(a.availableFromDate, a.availableFromTime) : null,
        projectType: p.projectType ?? null, projectName: p.projectName ?? null, clientName: p.clientName ?? null,
        trackupNumber: p.trackupNumber ?? null, pifNumber: p.pifNumber ?? null, projectStart: p.startDate ?? null, projectEnd: p.endDate ?? null,
        location: p.location ?? null, projectRemarks: p.remarks ?? null,
        expectedRelease: a?.status === "IN_USE" ? joinLabel(a.expectedReleaseDate, a.expectedReleaseTime) : null,
        nextAvailable: a?.status === "IN_USE" ? joinLabel(a.nextAvailableDate, a.nextAvailableTime) : null,
        issueCategory: i.category ?? null, issueDescription: i.description ?? null, issueReported: joinLabel(i.reportedDate, i.reportedTime),
        expectedRepair: joinLabel(i.expectedRepairDate, i.expectedRepairTime), garage: i.garage ?? null, repairRemarks: i.repairRemarks ?? null,
        issueStatus: i.issueStatus ?? null,
    };
}
const projectSnapshot = (a) => (a?.project && a.status === "IN_USE" ? { ...a.project, trackingProject: a.project.trackingProject ? String(a.project.trackingProject) : null } : null);
/**
 * Turns an availability change into history rows (never merged into an older row; history is append-only).
 * `prev` is the stored block (or undefined for a new / legacy vehicle), `next` the validated new block.
 */
export function availabilityHistory(prev, next) {
    const f0 = flattenAvailability(prev);
    const f1 = flattenAvailability(next);
    const all = diffVehicle(f0, f1, [...AV_FIELDS]);
    if (!all.length)
        return [];
    const from = (prev?.status ?? null);
    const to = next.status;
    const base = { previousStatus: from, newStatus: to, project: projectSnapshot(next) ?? projectSnapshot(prev), issueReason: next.issue?.description ?? prev?.issue?.description ?? null };
    const rows = [];
    const row = (action, changes) => changes.length && rows.push({ action, changes, ...base });
    const only = (names) => all.filter((c) => names.includes(c.field));
    const except = (names) => all.filter((c) => !names.includes(c.field));
    if (from !== to) {
        if (from === "ISSUE")
            row("ISSUE_RESOLVED", only(ISSUE_FIELDS));
        const rest = from === "ISSUE" ? except(ISSUE_FIELDS) : all;
        if (to === "AVAILABLE")
            row("MARKED_AVAILABLE", rest);
        else if (to === "IN_USE")
            row("PROJECT_ASSIGNED", rest);
        else if (to === "ISSUE")
            row("ISSUE_REPORTED", rest);
        else
            row("STATUS_CHANGED", rest);
        return rows;
    }
    if (to === "IN_USE") {
        const dates = ["expectedRelease", "nextAvailable"];
        row("RELEASE_CHANGED", only(dates));
        row("PROJECT_UPDATED", except(dates));
    }
    else if (to === "ISSUE") {
        row("REPAIR_DATE_CHANGED", only(["expectedRepair"]));
        row("ISSUE_UPDATED", except(["expectedRepair"]));
    }
    else if (to === "AVAILABLE")
        row("MARKED_AVAILABLE", all);
    else
        row("STATUS_CHANGED", all);
    return rows;
}
// ---- project linking (read-only on RSOP / budget data) --------------------------------------------
const arr = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x?.name ?? x?.location ?? "")).filter(Boolean) : []);
/** Shapes an RSOP project + one of its tracking vehicles (+ its approved budget) into the project block used by availability. */
export function projectFromTracking(tv, proj, budget) {
    const d = proj?.details ?? {};
    const road = proj?.projectType === "ROADSHOW";
    const client = proj?.clientName ?? "";
    const km = kmAllowanceOf(proj?.projectType, d);
    return {
        trackingProject: String(proj._id),
        trackingVehicle: String(tv._id),
        budget: budget ? String(budget._id) : null,
        budgetVersion: budget ? budget.approvedVersion : null,
        projectType: proj.projectType,
        projectName: road ? `${client} Roadshow` : `${client} Signage${d.jobSheetNumber ? ` – ${d.jobSheetNumber}` : ""}`,
        clientName: client,
        vehicleType: (tv.vehicleType ?? null), // requested by RSOP (read-only)
        trackupNumber: tv.trackupNumber,
        pifNumber: tv.pifNumber,
        startDate: (road ? d.startDate : d.fromDate) ?? null,
        endDate: (road ? d.endDate : d.toDate) ?? null,
        location: road ? arr(d.reportingLocations).join(", ") || null : d.location ?? null,
        remarks: null,
        billNumber: (d.billNumber ?? d.invoiceNumber ?? null), // only when the tracking record carries one
        // RoadShow KM allotment shown with the project (read-only; the availability validators never store these)
        totalAllowedKm: km?.totalAllowedKm ?? null,
        extraKmAllotted: km ? km.extraKmAllotted : null,
    };
}
/** A budget is allocatable only when it is Approved AND the approved version is the current one (no newer unapproved edit). */
export const APPROVED_BUDGET = { approvalStatus: "APPROVED", $expr: { $eq: ["$approvedVersion", "$currentVersion"] } };
export const isApprovedCurrent = (b) => !!b && b.approvalStatus === "APPROVED" && b.approvedVersion === b.currentVersion;
/**
 * Resolves the project a vehicle is being allocated to. A PIF identifies one vehicle; a Trackup alone works only when it covers a single vehicle.
 * the other is filled in from the database, and a mismatching pair is rejected. The project must have an Approved
 * budget. Details come from the records, never from the client. RSOP / budget data is only read.
 */
export async function resolveApprovedProject(trackupIn, pifIn) {
    const trackup = typeof trackupIn === "string" ? trackupIn.trim().toUpperCase() : "";
    const pif = typeof pifIn === "string" ? pifIn.trim().toUpperCase() : "";
    if (!trackup && !pif)
        return { error: "Enter a Trackup Number or PIF Number" };
    // A Trackup Number is shared by the vehicles of one type: the PIF Number identifies the vehicle.
    const [byT, byP] = await Promise.all([
        trackup ? TrackingVehicle.find({ trackupNumber: trackup }).limit(101).lean() : [],
        pif ? TrackingVehicle.findOne({ pifNumber: pif }).lean() : null,
    ]);
    if (trackup && !byT.length)
        return { error: `Trackup number ${trackup} was not found in the tracking records` };
    if (pif && !byP)
        return { error: `PIF number ${pif} was not found in the tracking records` };
    if (trackup && byP && byP.trackupNumber !== trackup)
        return { error: `Trackup number ${trackup} and PIF number ${pif} do not belong to the same project vehicle` };
    if (!byP && byT.length > 1)
        return { error: `Trackup number ${trackup} covers several vehicles; select the vehicle by its PIF Number` };
    const tv = byP ?? byT[0];
    const [proj, budget] = await Promise.all([TrackingProject.findById(tv.project).lean(), Budget.findOne({ vehicle: tv._id }).lean()]);
    if (!proj)
        return { error: `Project for trackup number ${tv.trackupNumber} was not found` };
    if (!isApprovedCurrent(budget)) {
        const st = budget ? (budget.approvalStatus ?? "DRAFT") : "not created";
        return { error: `Only approved projects can be allocated: the budget for ${tv.pifNumber} (${tv.trackupNumber}) is ${String(st).toLowerCase()}` };
    }
    return { tv, proj, budget };
}
/**
 * Prepares the IN_USE availability input: project details are filled from the approved records (never from the client).
 * Returns an error when the entered Trackup / PIF cannot be linked. Nothing entered => the block passes through unlinked
 * (a draft may be incomplete; a final save is rejected by the validator).
 */
export async function linkProject(input) {
    if (!input || typeof input !== "object" || input.status !== "IN_USE")
        return { input };
    const p = input.project && typeof input.project === "object" ? input.project : {};
    const hasT = typeof p.trackupNumber === "string" && p.trackupNumber.trim();
    const hasP = typeof p.pifNumber === "string" && p.pifNumber.trim();
    const blankLink = { trackingProject: undefined, trackingVehicle: undefined, budget: undefined, budgetVersion: undefined };
    if (!hasT && !hasP)
        return { input: { ...input, project: { ...p, ...blankLink } } };
    const r = await resolveApprovedProject(p.trackupNumber, p.pifNumber);
    if ("error" in r)
        return { input: { ...input, project: { ...p, ...blankLink } }, error: r.error };
    const linked = projectFromTracking(r.tv, r.proj, r.budget);
    // RBP may still state the location and add remarks; everything else is authoritative.
    return { input: { ...input, project: { ...linked, location: p.location || linked.location, remarks: p.remarks ?? null } } };
}
/** Another vehicle already holds this project vehicle as "In Use"? Friendly pre-check; the unique index is the real guard. */
export async function allocationConflict(pifNumber, exceptId) {
    if (!pifNumber)
        return null;
    const q = { "availability.status": "IN_USE", "availability.project.pifNumber": pifNumber };
    if (exceptId)
        q._id = { $ne: exceptId };
    const other = await Vehicle.findOne(q).select("vehicleNo").lean();
    return other ? `PIF number ${pifNumber} is already allocated to vehicle ${other.vehicleNo ?? "(draft)"}` : null;
}
const PROJECT_WORDS = { roadshow: "ROADSHOW", road: "ROADSHOW", signage: "SIGNAGE", sign: "SIGNAGE" };
/** Item for the picker: approved project vehicle + whether it is already allocated. */
async function toChoices(budgets) {
    if (!budgets.length)
        return [];
    const tvs = await TrackingVehicle.find({ _id: { $in: budgets.map((b) => b.vehicle) } }).lean();
    const projs = await TrackingProject.find({ _id: { $in: [...new Set(budgets.map((b) => String(b.project)))] } }).lean();
    const tvBy = new Map(tvs.map((t) => [String(t._id), t]));
    const pBy = new Map(projs.map((p) => [String(p._id), p]));
    const busy = await Vehicle.find({ "availability.status": "IN_USE", "availability.project.pifNumber": { $in: tvs.map((t) => t.pifNumber) } })
        .select("vehicleNo availability.project.pifNumber").lean();
    const busyBy = new Map(busy.map((v) => [v.availability.project.pifNumber, v.vehicleNo ?? "(draft)"]));
    return budgets
        .filter((b) => tvBy.has(String(b.vehicle)) && pBy.has(String(b.project)))
        .map((b) => {
        const tv = tvBy.get(String(b.vehicle));
        return { ...projectFromTracking(tv, pBy.get(String(b.project)), b), budgetNumber: b.budgetNumber, allocatedTo: busyBy.get(tv.pifNumber) ?? null };
    });
}
/**
 * Approved projects RBP can allocate a vehicle to (server-side search + pagination).
 * Draft / pending / rejected budgets, and approved budgets with a newer unapproved version, never appear.
 * Searches trackup, PIF, client / billing name, job sheet and project type (roadshow / signage).
 */
export async function searchApprovedProjects(q, page = 1, limit = 10, projectType) {
    const lim = Math.min(Math.max(limit, 1), 50);
    const pg = Math.max(page, 1);
    const term = q.trim();
    const filter = { ...APPROVED_BUDGET };
    if (term) {
        const rx = new RegExp(esc(term), "i");
        const types = Object.entries(PROJECT_WORDS).filter(([w]) => w.startsWith(term.toLowerCase()) && term.length >= 3).map(([, t]) => t);
        const [tvIds, pIds] = await Promise.all([
            TrackingVehicle.find({ $or: [{ trackupNumber: rx }, { pifNumber: rx }] }).distinct("_id"),
            TrackingProject.find({ $or: [{ clientName: rx }, { "details.jobSheetNumber": rx }, ...(types.length ? [{ projectType: { $in: types } }] : [])] }).distinct("_id"),
        ]);
        filter.$or = [{ vehicle: { $in: tvIds } }, { project: { $in: pIds } }];
    }
    if (asVertical(projectType))
        filter.$and = [{ project: { $in: await TrackingProject.find({ projectType }).distinct("_id") } }];
    const [rows, total] = await Promise.all([
        Budget.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((pg - 1) * lim).limit(lim).lean(),
        Budget.countDocuments(filter),
    ]);
    return { items: await toChoices(rows), total, page: pg, limit: lim };
}
/** Exact Trackup / PIF lookup for the auto-mapping (type one, get the other). */
export async function lookupApprovedProject(trackup, pif) {
    const r = await resolveApprovedProject(trackup, pif);
    if ("error" in r)
        return { error: r.error };
    const [choice] = await toChoices([r.budget]);
    return { choice };
}
/**
 * Allocations whose budget is no longer Approved (current version) are flagged for review; the vehicle status is never
 * changed silently. Returns vehicleId -> message.
 */
export async function budgetReviewFlags(vehicles) {
    const linked = vehicles.filter((v) => v.availability?.status === "IN_USE" && v.availability.project?.trackingVehicle);
    const out = new Map();
    if (!linked.length)
        return out;
    const budgets = await Budget.find({ vehicle: { $in: linked.map((v) => v.availability.project.trackingVehicle) } }).select("vehicle approvalStatus approvedVersion currentVersion").lean();
    const by = new Map(budgets.map((b) => [String(b.vehicle), b]));
    for (const v of linked) {
        const b = by.get(String(v.availability.project.trackingVehicle));
        if (!isApprovedCurrent(b))
            out.set(String(v._id), `Review needed: the project's budget is now ${String(b?.approvalStatus ?? "missing").toLowerCase()}, not approved`);
    }
    return out;
}
// ---- automatic release -----------------------------------------------------------------------------
export const AUTO_RELEASE_REASON = "Vehicle automatically marked Available after the scheduled release time.";
/**
 * Marks vehicles Available once their Next Available moment (IST) has been reached.
 * - Only IN_USE vehicles whose nextAvailableAt <= now are candidates.
 * - The update is conditional on the exact status + moment that was read, so a vehicle that was extended, changed to
 *   Vehicle Issue, or edited in the meantime is simply skipped (no overwrite, no race).
 * - It is idempotent: a released vehicle is no longer a candidate, and the history row carries a unique key.
 * - Only the active allocation is cleared; the project details are kept in the history row.
 */
export async function releaseDueVehicles(now = new Date(), batch = 500) {
    const nowAt = istNowAt(now);
    const due = await Vehicle.find({ "availability.status": "IN_USE", "availability.nextAvailableAt": { $lte: nowAt } })
        .sort({ "availability.nextAvailableAt": 1 }).limit(batch).lean();
    let released = 0;
    let skipped = 0;
    for (const v of due) {
        const a = v.availability;
        const at = a.nextAvailableAt;
        const [date, time] = at.split("T");
        const next = {
            status: "AVAILABLE", availableFromDate: date, availableFromTime: time, project: null,
            expectedReleaseDate: null, expectedReleaseTime: null, nextAvailableDate: null, nextAvailableTime: null, issue: null, nextAvailableAt: at,
        };
        const updated = await Vehicle.findOneAndUpdate({ _id: v._id, "availability.status": "IN_USE", "availability.nextAvailableAt": at, revision: v.revision }, {
            $set: { availability: { ...next, autoReleasedAt: now, ...(a.issueResolvedAt ? { issueResolvedAt: a.issueResolvedAt } : {}) }, updatedBy: "SYSTEM" },
            $inc: { revision: 1 },
        }, { new: false }).lean();
        if (!updated) {
            skipped++;
            continue;
        }
        released++;
        // the allotment record ends together with the vehicle's hold (same scheduler, no second job)
        await releaseActiveAllotments(v._id, { username: "SYSTEM", reason: AUTO_RELEASE_REASON, at: now });
        const rows = availabilityHistory(a, next);
        const changes = rows.flatMap((r) => r.changes);
        try {
            await VehicleHistory.create({
                vehicle: v._id, action: "AUTO_AVAILABILITY_UPDATE", username: "SYSTEM", changes, previousStatus: "IN_USE", newStatus: "AVAILABLE",
                project: rows[0]?.project ?? null, issueReason: null, reason: AUTO_RELEASE_REASON, autoKey: `${v._id}:${at}`,
            });
        }
        catch (e) {
            if (e.code !== 11000)
                throw e; // already recorded by an earlier run
        }
    }
    return { released, skipped };
}
