/* eslint-disable @typescript-eslint/no-explicit-any */
import { Driver, DriverHistory } from "../models/Driver.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { logAllotment } from "./allotment.core.js";
import { diffVehicle } from "../validators/vehicle.validator.js";
import { joinLabel } from "../validators/availability.validator.js";
import { istToday, nextDay } from "../validators/driverAvailability.validator.js";
import { projectFromTracking, resolveApprovedProject } from "./availability.service.js";
// ---- history: flat, human-friendly view of the availability block ---------------------------------
export const DRIVER_AV_FIELDS = [
    "availabilityStatus", "availableFrom", "projectType", "projectName", "clientName", "trackupNumber", "pifNumber", "projectFromDate", "projectToDate",
    "projectRemarks", "unavailableReason", "reasonCategory", "unavailableFrom", "expectedAvailableDate", "availabilityRemarks",
];
/** Flattens a stored / validated availability block so two of them can be diffed field by field. */
export function flattenDriverAvailability(a) {
    const p = a?.status === "IN_USE" ? (a.project ?? {}) : {};
    const n = a?.status === "NOT_AVAILABLE" ? (a.notAvailable ?? {}) : {};
    return {
        availabilityStatus: a?.status ?? null,
        availableFrom: a?.status === "AVAILABLE" ? joinLabel(a.availableFromDate, a.availableFromTime) : null,
        projectType: p.projectType ?? null, projectName: p.projectName ?? null, clientName: p.clientName ?? null,
        trackupNumber: p.trackupNumber ?? null, pifNumber: p.pifNumber ?? null, projectFromDate: p.startDate ?? null, projectToDate: p.endDate ?? null,
        projectRemarks: p.remarks ?? null,
        unavailableReason: n.reason ?? null, reasonCategory: n.category ?? null, unavailableFrom: n.fromDate ?? null,
        expectedAvailableDate: n.expectedAvailableDate ?? null, availabilityRemarks: n.remarks ?? null,
    };
}
const snapshot = (a) => a?.status === "IN_USE" && a.project
    ? { ...a.project, trackingProject: a.project.trackingProject ? String(a.project.trackingProject) : null, trackingVehicle: a.project.trackingVehicle ? String(a.project.trackingVehicle) : null, budget: a.project.budget ? String(a.project.budget) : null }
    : null;
/**
 * Turns an availability change into (at most one) history row. History is append-only, never merged into an older row.
 * `prev` is the stored block (undefined for a new / legacy driver), `next` the validated new block.
 * `created`: the driver is being created, so an initial "Available Now" needs no row of its own (the CREATED row covers it).
 */
export function driverAvailabilityHistory(prev, next, created = false) {
    const changes = diffVehicle(flattenDriverAvailability(prev), flattenDriverAvailability(next), [...DRIVER_AV_FIELDS]);
    if (!changes.length)
        return [];
    const from = (prev?.status ?? null);
    const to = next.status;
    if (created && to === "AVAILABLE")
        return [];
    let action;
    if (from !== to) {
        if (to === "IN_USE")
            action = "PROJECT_ASSIGNED";
        else if (to === "NOT_AVAILABLE")
            action = "MARKED_NOT_AVAILABLE";
        else
            action = from === "IN_USE" ? "STATUS_CHANGED" : "AVAILABILITY_CONFIRMED"; // Not Available / unset -> Available: RBP confirmed it
    }
    else if (to === "IN_USE") {
        const f = (k) => changes.find((c) => c.field === k);
        const newProject = f("trackupNumber") || f("pifNumber");
        const end = f("projectToDate");
        action = newProject ? "PROJECT_ASSIGNED" : end && String(end.to ?? "") > String(end.from ?? "") ? "PROJECT_EXTENDED" : "PROJECT_UPDATED";
    }
    else
        action = to === "NOT_AVAILABLE" ? "NOT_AVAILABLE_UPDATED" : "AVAILABILITY_UPDATED";
    return [{
            action, changes, previousStatus: from, newStatus: to,
            project: to === "IN_USE" ? snapshot(next) : from === "IN_USE" ? snapshot(prev) : null,
            reason: to === "NOT_AVAILABLE" ? next.notAvailable?.reason ?? null : null,
        }];
}
// ---- project linking (read-only on RSOP / budget data) --------------------------------------------
/**
 * Resolves the approved project for "In Use – Another Project": project details come from the tracking / budget records
 * (never from the client); the From / To dates are RBP's own entry and default to the project's dates when left blank.
 */
export async function linkDriverProject(input) {
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
    const { location: _location, billNumber: _bill, ...rest } = linked;
    void _location;
    void _bill;
    return { input: { ...input, project: { ...rest, startDate: p.startDate || linked.startDate, endDate: p.endDate || linked.endDate, remarks: p.remarks ?? null } } };
}
/** The availability block as stored: bumps the revision and stamps who / when. */
export function storedDriverAvailability(data, prev, username, now = new Date()) {
    return {
        ...data,
        revision: (prev?.revision ?? 0) + 1,
        lastStatusUpdatedBy: username,
        lastStatusUpdatedAt: now,
        ...(prev?.autoReleasedAt && data.status === "AVAILABLE" ? { autoReleasedAt: prev.autoReleasedAt } : {}),
    };
}
// ---- automatic release -----------------------------------------------------------------------------
export const AUTO_RELEASE_REASON = "Driver automatically marked Available after the project to date passed.";
/**
 * Marks drivers Available once their Project To Date (IST) is over, i.e. earlier than today's IST date.
 * - Only IN_USE drivers whose project end date < today are candidates; Not Available drivers are never touched.
 * - The update is conditional on the exact status + end date + availability revision that was read, so a driver whose
 *   project was extended, who was manually changed or who got a newer allocation in the meantime is simply skipped.
 * - Idempotent: a released driver is no longer a candidate, and the history row carries a unique key.
 * - Only the active availability is replaced; the previous project stays in the history row. Nothing else is modified.
 */
export async function releaseDueDrivers(now = new Date(), batch = 500) {
    const today = istToday(now);
    const due = await Driver.find({ "availability.status": "IN_USE", "availability.project.endDate": { $lt: today } })
        .sort({ "availability.project.endDate": 1 }).limit(batch).lean();
    let released = 0;
    let skipped = 0;
    for (const d of due) {
        const a = d.availability;
        const end = a.project.endDate;
        const next = { status: "AVAILABLE", availableFromDate: nextDay(end), availableFromTime: "00:00", project: null, notAvailable: null };
        const updated = await Driver.findOneAndUpdate({ _id: d._id, "availability.status": "IN_USE", "availability.project.endDate": end, "availability.revision": a.revision ?? null }, { $set: { availability: { ...next, revision: (a.revision ?? 0) + 1, lastStatusUpdatedBy: "SYSTEM", lastStatusUpdatedAt: now, autoReleasedAt: now } } }, { new: false }).lean();
        if (!updated) {
            skipped++;
            continue;
        }
        released++;
        if (a.project?.allotment) {
            // the driver was held by a vehicle allotment: that allotment no longer has an active driver (its details stay for history)
            const done = await VehicleAllotment.updateOne({ _id: a.project.allotment, activeDriver: d._id }, { $unset: { activeDriver: 1 }, $set: { driverReleasedAt: now } });
            if (done.modifiedCount)
                await logAllotment(a.project.allotment, "DRIVER_RELEASED", "SYSTEM", { driverId: String(d._id), driverNumber: d.driverNumber, driverName: d.driverName, reason: AUTO_RELEASE_REASON, releasedAt: now });
        }
        const rows = driverAvailabilityHistory(a, next);
        try {
            await DriverHistory.create({
                driver: d._id, action: "AUTO_AVAILABILITY_UPDATE", username: "SYSTEM", changes: rows.flatMap((r) => r.changes),
                previousStatus: "IN_USE", newStatus: "AVAILABLE", project: rows[0]?.project ?? snapshot(a), reason: AUTO_RELEASE_REASON, autoKey: `${d._id}:${end}:${a.revision ?? 1}`,
            });
        }
        catch (e) {
            if (e.code !== 11000)
                throw e; // already recorded by an earlier run
        }
    }
    return { released, skipped };
}
