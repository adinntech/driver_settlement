/* eslint-disable @typescript-eslint/no-explicit-any */
import { AllotmentEvent, VehicleAllotment } from "../models/VehicleAllotment.js";
import { istParts } from "../validators/availability.validator.js";

/**
 * Low-level allotment bookkeeping shared by the allotment service, the vehicle form and the availability scheduler.
 * It only touches allotment collections (no import of the vehicle / availability services), so there is no import cycle.
 */

/** IST wall-clock date + time -> instant. */
export const istToDate = (d?: string | null, t?: string | null): Date | null => (d && t ? new Date(`${d}T${t}:00+05:30`) : null);
/** Instant -> IST date + time strings (the shape the vehicle availability block uses). */
export const dateToIst = (x?: Date | null) => (x ? istParts(new Date(x)) : null);

export const logAllotment = (allotment: unknown, action: string, username: string, details: Record<string, unknown> | null) =>
  AllotmentEvent.create({ allotment, action, username, details });

/** Active allotment(s) of a vehicle end (RELEASED). Idempotent: only ACTIVE rows are touched. */
export async function releaseActiveAllotments(vehicleId: unknown, o: { username: string; reason: string; at?: Date }): Promise<number> {
  const at = o.at ?? new Date();
  const active: any[] = await VehicleAllotment.find({ vehicle: vehicleId, status: "ACTIVE" }).lean();
  let n = 0;
  for (const a of active) {
    const done = await VehicleAllotment.findOneAndUpdate(
      { _id: a._id, status: "ACTIVE" },
      { $set: { status: "RELEASED", releasedAt: at, releaseReason: o.reason, updatedBy: o.username } },
      { returnDocument: "after" },
    ).lean();
    if (!done) continue;
    n++;
    await logAllotment(a._id, "RELEASED", o.username, { reason: o.reason, vehicleNo: a.vehicleNo, trackupNumber: a.trackupNumber, releasedAt: at });
    // the allotment's driver (if any) ends together with it; loaded lazily to keep this module free of service imports
    if (a.activeDriver) await (await import("./allotmentDriver.service.js")).releaseAllotmentDriver(a, { username: o.username, reason: o.reason, at });
  }
  return n;
}

/**
 * Keeps allotment records consistent when a vehicle's availability is changed from the Vehicle Management form.
 * - leaving "In Use" (or moving to another project) releases the active allotment;
 * - a linked "In Use" vehicle with no active allotment gets one (source VEHICLE_FORM);
 * - a changed expected release / next available time on the same project is recorded as an extension.
 */
export async function syncAllotmentFromVehicle(vehicle: any, prev: any, username: string): Promise<void> {
  const cur = vehicle?.availability;
  const prevPif = prev?.status === "IN_USE" ? prev.project?.pifNumber ?? null : null;
  const curPif = cur?.status === "IN_USE" ? cur.project?.pifNumber ?? null : null;
  if (prevPif && prevPif !== curPif)
    await releaseActiveAllotments(vehicle._id, { username, reason: "Vehicle availability was changed in Vehicle Management" });
  if (!curPif || !cur.project?.trackingVehicle) return;

  const expected = istToDate(cur.expectedReleaseDate, cur.expectedReleaseTime);
  const next = istToDate(cur.nextAvailableDate, cur.nextAvailableTime); // null = no next-available moment (optional)
  const active: any = await VehicleAllotment.findOne({ trackingVehicle: cur.project.trackingVehicle, status: "ACTIVE" }).lean();
  if (!active) {
    const p = cur.project;
    try {
      const a: any = await VehicleAllotment.create({
        vehicle: vehicle._id, vehicleNo: vehicle.vehicleNo, vehicleMake: vehicle.make, vehicleModel: vehicle.model,
        project: p.trackingProject, trackingVehicle: p.trackingVehicle, budget: p.budget, budgetVersion: p.budgetVersion,
        trackupNumber: p.trackupNumber, pifNumber: p.pifNumber, clientName: p.clientName, projectType: p.projectType, projectName: p.projectName,
        projectStart: p.startDate, projectEnd: p.endDate, allottedAt: new Date(), expectedReleaseAt: expected, nextAvailableAt: next,
        remarks: p.remarks || undefined, status: "ACTIVE", source: "VEHICLE_FORM", createdBy: username, updatedBy: username,
      });
      await logAllotment(a._id, "ALLOTTED", username, { vehicleNo: vehicle.vehicleNo, source: "VEHICLE_FORM", expectedReleaseAt: expected, nextAvailableAt: next });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // another active allotment holds it; the unique indexes already protect consistency
    }
    return;
  }
  if (String(active.vehicle) !== String(vehicle._id)) return;
  const changed = +(active.nextAvailableAt ? new Date(active.nextAvailableAt) : 0) !== +(next ?? 0) || +(active.expectedReleaseAt ? new Date(active.expectedReleaseAt) : 0) !== +(expected ?? 0);
  if (changed) {
    await VehicleAllotment.updateOne({ _id: active._id, status: "ACTIVE" }, { $set: { expectedReleaseAt: expected, nextAvailableAt: next, updatedBy: username } });
    await logAllotment(active._id, "EXTENDED", username, {
      from: { expectedReleaseAt: active.expectedReleaseAt ?? null, nextAvailableAt: active.nextAvailableAt ?? null },
      to: { expectedReleaseAt: expected, nextAvailableAt: next }, source: "VEHICLE_FORM",
    });
    if (active.activeDriver) await (await import("./allotmentDriver.service.js")).syncDriverSchedule({ ...active, expectedReleaseAt: expected, nextAvailableAt: next }, username);
  }
}
