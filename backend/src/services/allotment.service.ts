/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { Vehicle, VehicleHistory } from "../models/Vehicle.js";
import { Driver, DriverHistory } from "../models/Driver.js";
import { AllotmentEvent, VehicleAllotment } from "../models/VehicleAllotment.js";
import { Budget } from "../models/Budget.js";
import { TrackingProject } from "../models/TrackingProject.js";
import {
  allocatability, istNowAt, istParts, joinAt, validateAvailability, type AvailabilityData,
} from "../validators/availability.validator.js";
import { validateAllot, validateChange, validateRelease, validateSchedule, type Schedule } from "../validators/allotment.validator.js";
import { allocationConflict, availabilityHistory, projectFromTracking, resolveApprovedProject, searchApprovedProjects } from "./availability.service.js";
import { dateToIst, istToDate, logAllotment } from "./allotment.core.js";
import {
  allotmentDriverView, driverFields, driverInUseBlock, driverUnavailableReason, releaseAllotmentDriver, reserveDriver, restoreDriver, syncDriverSchedule,
} from "./allotmentDriver.service.js";
import { driverAvailabilityHistory } from "./driverAvailability.service.js";
import { attachmentUrl } from "./storage.service.js";
import { AppError } from "../utils/AppError.js";

const validId = (id: string) => /^[a-f0-9]{24}$/i.test(id);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

const withUrls = (a: any) => ({
  ...a,
  changeAttachments: (a.changeAttachments ?? []).map((x: any) => ({ ...x, url: attachmentUrl(x) })),
});

/** The availability input (same shape the Vehicle form uses) for an allotment of a vehicle to a project vehicle. */
const availabilityInput = (p: any, remarks: string | null, s: Schedule) => ({
  status: "IN_USE",
  project: {
    trackingProject: p.trackingProject ? String(p.trackingProject) : undefined, trackingVehicle: p.trackingVehicle ? String(p.trackingVehicle) : undefined,
    budget: p.budget ? String(p.budget) : undefined, budgetVersion: p.budgetVersion ?? undefined,
    projectType: p.projectType, projectName: p.projectName, clientName: p.clientName, trackupNumber: p.trackupNumber, pifNumber: p.pifNumber,
    startDate: p.startDate ?? undefined, endDate: p.endDate ?? undefined, location: p.location ?? undefined, remarks: remarks ?? undefined,
  },
  expectedReleaseDate: s.expectedReleaseDate ?? undefined, expectedReleaseTime: s.expectedReleaseTime ?? undefined,
  nextAvailableDate: s.nextAvailableDate, nextAvailableTime: s.nextAvailableTime,
});

/** Why a vehicle cannot be allotted right now (null = it can). Only an active, "Available Now" vehicle qualifies. */
function unavailableReason(v: any, now: Date): string | null {
  if (!v) return "Vehicle not found";
  if (v.status !== "ACTIVE") return `Vehicle ${v.vehicleNo ?? ""} is ${String(v.status).toLowerCase()}; only active vehicles can be allotted`;
  const a = allocatability(v.availability, now);
  if (a.allocatable) return null;
  if (v.availability?.status === "ISSUE") return `Vehicle ${v.vehicleNo} has a vehicle issue and cannot be allotted`;
  if (v.availability?.status === "IN_USE") return `Vehicle ${v.vehicleNo} is already in use on another project`;
  return `Vehicle ${v.vehicleNo} is no longer available (${a.reason})`;
}

/** Atomically takes an Available vehicle; null if it changed in the meantime (or the project vehicle is already held). */
async function reserveVehicle(v: any, data: AvailabilityData, username: string): Promise<any | null | "CONFLICT"> {
  try {
    return await Vehicle.findOneAndUpdate(
      { _id: v._id, status: "ACTIVE", revision: v.revision, "availability.status": "AVAILABLE" },
      { $set: { availability: data, updatedBy: username }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    ).lean();
  } catch (e) {
    if (isDup(e)) return "CONFLICT";
    throw e;
  }
}

/** Puts a vehicle back exactly as it was (compensation). Guarded by the revision we produced, so it never clobbers newer edits. */
const restoreVehicle = (vehicleId: unknown, revision: number, prevAvailability: any, username: string) =>
  Vehicle.updateOne({ _id: vehicleId, revision }, { $set: { availability: prevAvailability, updatedBy: username }, $inc: { revision: 1 } });

/** "Available now" block for a vehicle that has just been released. */
function availableNowBlock(prev: any, now: Date): AvailabilityData & { issueResolvedAt?: Date } {
  const p = istParts(now);
  return {
    status: "AVAILABLE", availableFromDate: p.date, availableFromTime: p.time, project: null, expectedReleaseDate: null, expectedReleaseTime: null,
    nextAvailableDate: null, nextAvailableTime: null, issue: null, nextAvailableAt: `${p.date}T${p.time}`,
    ...(prev?.issueResolvedAt ? { issueResolvedAt: prev.issueResolvedAt } : {}),
  };
}

/** Frees the vehicle that currently holds this allotment's project vehicle (PIF). Null when its state no longer matches. */
async function freeVehicle(vehicleId: unknown, pif: string, username: string, now: Date): Promise<{ before: any; after: any } | null> {
  const cur: any = await Vehicle.findById(vehicleId).lean();
  if (!cur || cur.availability?.status !== "IN_USE" || cur.availability.project?.pifNumber !== pif) return null;
  const block = availableNowBlock(cur.availability, now);
  const after: any = await Vehicle.findOneAndUpdate(
    { _id: vehicleId, revision: cur.revision, "availability.status": "IN_USE", "availability.project.pifNumber": pif },
    { $set: { availability: block, updatedBy: username }, $inc: { revision: 1 } },
    { returnDocument: "after" },
  ).lean();
  return after ? { before: cur, after } : null;
}

const vehicleRows = (prev: any, next: AvailabilityData, vehicle: unknown, username: string, reason?: string) =>
  availabilityHistory(prev, next).map((r) => ({ ...r, vehicle, username, ...(reason ? { reason } : {}) }));

// ---------------------------------------------------------------- queries

/** Vehicles that can be allotted right now: active, "Available Now" and past their available-from moment. */
export async function searchAvailableVehicles(q: string, limit = 10, now = new Date()) {
  const lim = Math.min(Math.max(limit, 1), 25);
  const nowAt = istNowAt(now);
  const filter: any = {
    status: "ACTIVE", vehicleNo: { $type: "string" }, "availability.status": "AVAILABLE",
    $or: [{ "availability.nextAvailableAt": { $lte: nowAt } }, { "availability.nextAvailableAt": null }],
  };
  const term = q.trim().replace(/[ -]/g, "").toUpperCase();
  if (term) filter.vehicleNo = new RegExp(esc(term), "i");
  const items = await Vehicle.find(filter).select("vehicleNo make model type").sort({ vehicleNo: 1 }).limit(lim).lean();
  return items.map((v: any) => ({ _id: String(v._id), vehicleNo: v.vehicleNo, make: v.make ?? null, model: v.model ?? null, type: v.type ?? null }));
}

/** Approved projects (one row per project vehicle = its own PIF) with their current allotment, if any. */
export async function listAllotmentProjects(q: string, page = 1, limit = 10) {
  const base = await searchApprovedProjects(q, page, limit);
  const items = base.items as any[];
  if (!items.length) return base;
  const [budgets, projects, allots]: any[][] = await Promise.all([
    Budget.find({ _id: { $in: items.map((i) => i.budget).filter(Boolean) } }).select("total reviewedAt approvalStatus approvedVersion budgetNumber").lean(),
    TrackingProject.find({ _id: { $in: [...new Set(items.map((i) => i.trackingProject))] } }).select("vehicleCount").lean(),
    VehicleAllotment.find({ trackingVehicle: { $in: items.map((i) => i.trackingVehicle) }, status: "ACTIVE" }).lean(),
  ]);
  const bBy = new Map(budgets.map((b) => [String(b._id), b]));
  const pBy = new Map(projects.map((p) => [String(p._id), p]));
  const aBy = new Map(allots.map((a) => [String(a.trackingVehicle), a]));
  return {
    ...base,
    items: items.map((i) => {
      const b = bBy.get(String(i.budget));
      const a = aBy.get(String(i.trackingVehicle));
      return {
        ...i, vehicleCount: pBy.get(String(i.trackingProject))?.vehicleCount ?? null, budgetAmount: b?.total ?? null,
        approvedAt: b?.reviewedAt ?? null, budgetStatus: b?.approvalStatus ?? "APPROVED",
        allotment: a ? {
          _id: String(a._id), vehicleId: String(a.vehicle), vehicleNo: a.vehicleNo, allottedAt: a.allottedAt, expectedReleaseAt: a.expectedReleaseAt ?? null,
          nextAvailableAt: a.nextAvailableAt, remarks: a.remarks ?? null,
          // the driver currently on this allotment (null = vehicle only / Driver Not Assigned)
          driver: a.activeDriver ? { driverId: String(a.activeDriver), driverNumber: a.driverNumber ?? null, driverName: a.driverName ?? null, driverType: a.driverType ?? null, mobileNumber: a.driverMobile ?? null, assignedAt: a.driverAssignedAt ?? null } : null,
        } : null,
      };
    }),
  };
}

export interface AllotmentListQuery {
  q?: string; vehicleNo?: string; clientName?: string; trackupNumber?: string; pifNumber?: string; projectType?: string;
  status?: string; from?: string; to?: string; page?: number; limit?: number;
}

export function allotmentFilter(q: AllotmentListQuery) {
  const and: any[] = [];
  const rx = (v: string) => new RegExp(esc(v.trim()), "i");
  if (q.q?.trim()) {
    const r = rx(q.q);
    const compact = rx(q.q.replace(/[ -]/g, "").toUpperCase());
    and.push({ $or: [{ vehicleNo: compact }, { changedFromVehicleNo: compact }, { clientName: r }, { projectName: r }, { trackupNumber: r }, { pifNumber: r }, { billNumber: r }] });
  }
  if (q.vehicleNo?.trim()) { const c = rx(q.vehicleNo.replace(/[ -]/g, "").toUpperCase()); and.push({ $or: [{ vehicleNo: c }, { changedFromVehicleNo: c }] }); }
  if (q.clientName?.trim()) and.push({ clientName: rx(q.clientName) });
  if (q.trackupNumber?.trim()) and.push({ trackupNumber: rx(q.trackupNumber) });
  if (q.pifNumber?.trim()) and.push({ pifNumber: rx(q.pifNumber) });
  if (q.projectType && ["ROADSHOW", "SIGNAGE"].includes(q.projectType)) and.push({ projectType: q.projectType });
  if (q.status && ["ACTIVE", "RELEASED", "CHANGED"].includes(q.status)) and.push({ status: q.status });
  if (q.from || q.to) {
    const r: any = {};
    if (q.from) r.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (q.to) r.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
    and.push({ allottedAt: r });
  }
  return and.length ? { $and: and } : {};
}

/** Allotment history, latest first, paginated on the server. */
export async function listAllotments(q: AllotmentListQuery) {
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const filter = allotmentFilter(q);
  const [items, total] = await Promise.all([
    VehicleAllotment.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    VehicleAllotment.countDocuments(filter),
  ]);
  return { items: items.map(withUrls), total, page, limit };
}

/** One allotment with its project, the vehicle chain (original -> current), live vehicle details and the activity timeline. */
export async function allotmentDetail(id: string) {
  if (!validId(id)) throw new AppError("Invalid allotment id", 400);
  const a: any = await VehicleAllotment.findById(id).lean();
  if (!a) throw new AppError("Allotment not found", 404);
  // every allotment of this project vehicle, oldest first = the full vehicle chain
  const chain: any[] = await VehicleAllotment.find({ trackingVehicle: a.trackingVehicle }).sort({ createdAt: 1, _id: 1 }).lean();
  const ids = chain.map((c) => c._id);
  const [events, vehicle]: any[] = await Promise.all([
    AllotmentEvent.find({ allotment: { $in: ids } }).sort({ createdAt: -1, _id: -1 }).lean(),
    Vehicle.findById(a.vehicle).select("vehicleNo make model type status availability").lean(),
  ]);
  const current = chain.find((c) => c.status === "ACTIVE") ?? chain[chain.length - 1];
  return {
    allotment: withUrls(a),
    original: chain[0] ? { vehicleNo: chain[0].vehicleNo, vehicleMake: chain[0].vehicleMake, vehicleModel: chain[0].vehicleModel } : null,
    current: current ? { vehicleNo: current.vehicleNo, vehicleMake: current.vehicleMake, vehicleModel: current.vehicleModel, status: current.status } : null,
    chain: chain.map(withUrls),
    vehicle: vehicle ? { ...vehicle, availabilityStatus: (vehicle as any).availability?.status ?? null } : null,
    driver: await allotmentDriverView(a), // null = Driver Not Assigned (vehicle-only and older allotments)
    events,
  };
}

// ---------------------------------------------------------------- commands

export async function allotVehicle(input: unknown, username: string, now = new Date()) {
  const v = validateAllot(input, now);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const d = v.data;
  const r = await resolveApprovedProject(d.trackupNumber, d.pifNumber); // also proves trackup and PIF belong together
  if ("error" in r) throw new AppError(r.error, 400);
  const p = projectFromTracking(r.tv, r.proj, r.budget);

  const taken: any = await VehicleAllotment.findOne({ trackingVehicle: r.tv._id, status: "ACTIVE" }).lean();
  if (taken) throw new AppError(`PIF ${p.pifNumber} (${p.trackupNumber}) is already allotted to vehicle ${taken.vehicleNo}; use Change Vehicle to replace it`, 409);
  const veh: any = await Vehicle.findById(d.vehicleId).lean();
  const why = unavailableReason(veh, now);
  if (why) throw new AppError(why, veh ? 409 : 404);

  const av = validateAvailability(availabilityInput(p, d.remarks, d.schedule), false, now, null);
  if (av.errors.length || !av.data) throw new AppError(av.errors.join("; "), 400);
  const clash = await allocationConflict(p.pifNumber);
  if (clash) throw new AppError(clash, 409);

  // Option B (vehicle + driver): the driver is validated up front for a friendly error, and taken atomically below.
  let drv: any = null;
  if (d.driverId) {
    drv = await Driver.findById(d.driverId).lean();
    const dw = driverUnavailableReason(drv, now);
    if (dw) throw new AppError(dw, drv ? 409 : 404);
    if (await VehicleAllotment.exists({ activeDriver: drv._id })) throw new AppError(`Driver ${drv.driverNumber} is already assigned to another vehicle`, 409);
  }

  const reserved = await reserveVehicle(veh, av.data, username);
  if (!reserved || reserved === "CONFLICT") throw new AppError(`Vehicle ${veh.vehicleNo} is no longer available`, 409);

  const allotmentId = new mongoose.Types.ObjectId();
  const nextAt = istToDate(d.schedule.nextAvailableDate, d.schedule.nextAvailableTime); // optional
  let reservedDrv: any = null;
  let drvBlock: any = null;
  if (drv) {
    drvBlock = driverInUseBlock({
      project: p.trackingProject, trackingVehicle: p.trackingVehicle, budget: p.budget, budgetVersion: p.budgetVersion, projectType: p.projectType, projectName: p.projectName,
      clientName: p.clientName, trackupNumber: p.trackupNumber, pifNumber: p.pifNumber, allottedAt: d.allottedAt, nextAvailableAt: nextAt, expectedReleaseAt: istToDate(d.schedule.expectedReleaseDate, d.schedule.expectedReleaseTime), projectEnd: p.endDate ?? null, remarks: d.remarks,
      vehicle: veh._id, vehicleNo: veh.vehicleNo,
    }, allotmentId);
    reservedDrv = await reserveDriver(drv, drvBlock, username, now);
    if (!reservedDrv) {
      await restoreVehicle(veh._id, reserved.revision, veh.availability, username); // nothing half-done is left behind
      throw new AppError(`Driver ${drv.driverNumber} is no longer available; no vehicle was allotted`, 409);
    }
  }

  let a: any;
  try {
    a = await VehicleAllotment.create({
      _id: allotmentId, ...(drv ? driverFields(drv, username, now) : {}),
      vehicle: veh._id, vehicleNo: veh.vehicleNo, vehicleMake: veh.make, vehicleModel: veh.model,
      project: p.trackingProject, trackingVehicle: p.trackingVehicle, budget: p.budget, budgetVersion: p.budgetVersion,
      trackupNumber: p.trackupNumber, pifNumber: p.pifNumber, billNumber: p.billNumber ?? undefined, clientName: p.clientName,
      projectType: p.projectType, projectName: p.projectName, projectStart: p.startDate ?? undefined, projectEnd: p.endDate ?? undefined,
      requestedVehicleType: p.vehicleType ?? undefined,
      allottedAt: d.allottedAt, expectedReleaseAt: istToDate(d.schedule.expectedReleaseDate, d.schedule.expectedReleaseTime),
      nextAvailableAt: nextAt, remarks: d.remarks ?? undefined,
      status: "ACTIVE", source: "ALLOTMENT", createdBy: username, updatedBy: username,
    });
  } catch (e) {
    if (reservedDrv) await restoreDriver(drv._id, reservedDrv.availability.revision, drv.availability, username);
    await restoreVehicle(veh._id, reserved.revision, veh.availability, username); // nothing half-done is left behind
    if (isDup(e) && /activeDriver/.test(String((e as any).message))) throw new AppError(`Driver ${drv?.driverNumber} was just assigned to another vehicle; no vehicle was allotted`, 409);
    if (isDup(e)) throw new AppError(`PIF ${p.pifNumber} (${p.trackupNumber}) was just allotted to another vehicle`, 409);
    throw e;
  }
  await logAllotment(a._id, "ALLOTTED", username, {
    vehicleNo: veh.vehicleNo, trackupNumber: p.trackupNumber, pifNumber: p.pifNumber, billNumber: p.billNumber ?? null,
    allottedAt: d.allottedAt, expectedReleaseAt: a.expectedReleaseAt ?? null, nextAvailableAt: a.nextAvailableAt ?? null, remarks: d.remarks,
    ...(drv ? { driverNumber: drv.driverNumber } : {}),
  });
  if (drv) {
    await logAllotment(a._id, "DRIVER_ASSIGNED", username, {
      driverId: String(drv._id), driverNumber: drv.driverNumber, driverName: drv.driverName, driverType: drv.driverType, mobileNumber: drv.mobileNumber,
      vehicleNo: veh.vehicleNo, trackupNumber: p.trackupNumber, assignedAt: now, later: false,
    });
    const drows = driverAvailabilityHistory(drv.availability, drvBlock).map((r) => ({
      ...r, driver: drv._id, username, reason: `Allotted with vehicle ${veh.vehicleNo} to ${p.projectName} (${p.trackupNumber}, ${p.pifNumber})`,
    }));
    if (drows.length) await DriverHistory.insertMany(drows);
  }
  const rows = vehicleRows(veh.availability, av.data, veh._id, username, `Allotted to ${p.projectName} (${p.trackupNumber}, ${p.pifNumber})`);
  if (rows.length) await VehicleHistory.insertMany(rows);
  return withUrls(a.toObject());
}

/**
 * Replaces the vehicle of an active allotment. The standalone MongoDB has no multi-document transactions, so the steps run in
 * a safe order with compensation: the original allotment and vehicle are only given up after validation, and every failure
 * after that point puts them back exactly as they were.
 */
export async function changeVehicle(id: string, input: unknown, username: string, now = new Date()) {
  if (!validId(id)) throw new AppError("Invalid allotment id", 400);
  const v = validateChange(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const d = v.data;
  const old: any = await VehicleAllotment.findById(id).lean();
  if (!old) throw new AppError("Allotment not found", 404);
  if (old.status !== "ACTIVE") throw new AppError("Only an active allotment can be changed", 409);
  if (String(old.vehicle) === d.vehicleId) throw new AppError("Choose a different vehicle as the replacement", 400);

  const repl: any = await Vehicle.findById(d.vehicleId).lean();
  const why = unavailableReason(repl, now);
  if (why) throw new AppError(why, repl ? 409 : 404);
  const oldVeh: any = await Vehicle.findById(old.vehicle).lean();
  if (!oldVeh || oldVeh.availability?.status !== "IN_USE" || oldVeh.availability.project?.pifNumber !== old.pifNumber)
    throw new AppError("The current vehicle's availability no longer matches this allotment; refresh and check Vehicle Management", 409);

  // the project identifiers and schedule are preserved from the original allotment
  const exp = dateToIst(old.expectedReleaseAt);
  const nxt = dateToIst(old.nextAvailableAt);
  const sched: Schedule = { expectedReleaseDate: exp?.date ?? null, expectedReleaseTime: exp?.time ?? null, nextAvailableDate: nxt?.date ?? null, nextAvailableTime: nxt?.time ?? null };
  const p = oldVeh.availability.project;
  const av = validateAvailability(availabilityInput(p, old.remarks ?? null, sched), false, now, oldVeh.availability);
  if (av.errors.length || !av.data) throw new AppError(av.errors.join("; "), 400);

  // 1) the original allotment steps aside (guarded: someone else may have just changed it)
  const stepped = await VehicleAllotment.findOneAndUpdate(
    { _id: old._id, status: "ACTIVE" }, { $set: { status: "CHANGED", updatedBy: username }, ...(old.activeDriver ? { $unset: { activeDriver: 1 } } : {}) }, { returnDocument: "after" },
  ).lean();
  if (!stepped) throw new AppError("This allotment was just changed by someone else; refresh and retry", 409);
  const undoAllotment = () =>
    VehicleAllotment.updateOne({ _id: old._id }, { $set: { status: "ACTIVE", updatedBy: old.updatedBy, ...(old.activeDriver ? { activeDriver: old.activeDriver } : {}) }, $unset: { replacedBy: 1 } });

  // 2) the original vehicle is released (its hold would otherwise block the replacement on the same PIF)
  const freed = await freeVehicle(oldVeh._id, old.pifNumber, username, now);
  if (!freed) {
    await undoAllotment();
    throw new AppError("The current vehicle changed while replacing it; nothing was changed, please retry", 409);
  }
  const undoOld = () => restoreVehicle(oldVeh._id, freed.after.revision, oldVeh.availability, username);

  // 3) the replacement is taken atomically
  const reserved = await reserveVehicle(repl, av.data, username);
  if (!reserved || reserved === "CONFLICT") {
    await undoOld();
    await undoAllotment();
    throw new AppError(`Vehicle ${repl.vehicleNo} is no longer available; the original allotment is unchanged`, 409);
  }

  // 4) the new allotment row
  let created: any;
  try {
    created = await VehicleAllotment.create({
      vehicle: repl._id, vehicleNo: repl.vehicleNo, vehicleMake: repl.make, vehicleModel: repl.model,
      project: old.project, trackingVehicle: old.trackingVehicle, budget: old.budget, budgetVersion: old.budgetVersion,
      trackupNumber: old.trackupNumber, pifNumber: old.pifNumber, billNumber: old.billNumber, clientName: old.clientName,
      projectType: old.projectType, projectName: old.projectName, projectStart: old.projectStart, projectEnd: old.projectEnd,
      requestedVehicleType: old.requestedVehicleType,
      allottedAt: now, expectedReleaseAt: old.expectedReleaseAt, nextAvailableAt: old.nextAvailableAt, remarks: old.remarks,
      status: "ACTIVE", source: "ALLOTMENT", previousAllotment: old._id, changedFromVehicleNo: old.vehicleNo, changeReason: d.reason,
      changeRemarks: d.remarks ?? undefined, changeAttachments: d.attachments, changedAt: now, createdBy: username, updatedBy: username,
      // the driver stays with the project vehicle: carried over to the replacement allotment
      ...(old.driver ? {
        driver: old.driver, driverNumber: old.driverNumber, driverName: old.driverName, driverType: old.driverType, driverMobile: old.driverMobile,
        driverAssignedAt: old.driverAssignedAt, driverAssignedBy: old.driverAssignedBy, driverReleasedAt: old.driverReleasedAt,
        ...(old.activeDriver ? { activeDriver: old.activeDriver } : {}),
      } : {}),
    });
  } catch (e) {
    await restoreVehicle(repl._id, reserved.revision, repl.availability, username);
    await undoOld();
    await undoAllotment();
    if (isDup(e)) throw new AppError("This project vehicle was just allotted by someone else; the original allotment is unchanged", 409);
    throw e;
  }
  await VehicleAllotment.updateOne({ _id: old._id }, { $set: { replacedBy: created._id } });
  if (old.activeDriver) // the driver's allocation now points at the new allotment / vehicle
    await Driver.updateOne({ _id: old.activeDriver, "availability.project.allotment": old._id }, {
      $set: { "availability.project.allotment": created._id, "availability.project.vehicle": repl._id, "availability.project.vehicleNo": repl.vehicleNo },
    });

  // 5) immutable records
  const detail = { fromVehicleNo: old.vehicleNo, toVehicleNo: repl.vehicleNo, reason: d.reason, remarks: d.remarks, attachments: d.attachments, changedAt: now };
  await logAllotment(old._id, "VEHICLE_CHANGED", username, { ...detail, newAllotment: created._id });
  await logAllotment(created._id, "ALLOTTED", username, { vehicleNo: repl.vehicleNo, replacing: old.vehicleNo, reason: d.reason, trackupNumber: old.trackupNumber, nextAvailableAt: old.nextAvailableAt });
  const rows = [
    ...vehicleRows(oldVeh.availability, availableNowBlock(oldVeh.availability, now), oldVeh._id, username, `Replaced by ${repl.vehicleNo}: ${d.reason}`),
    ...vehicleRows(repl.availability, av.data, repl._id, username, `Allotted as replacement for ${old.vehicleNo}`),
  ];
  if (rows.length) await VehicleHistory.insertMany(rows);
  return withUrls(created.toObject());
}

/** Project extension: new expected release / next available moment, mirrored on the vehicle's availability. */
export async function extendAllotment(id: string, input: unknown, username: string, now = new Date()) {
  if (!validId(id)) throw new AppError("Invalid allotment id", 400);
  const v = validateSchedule(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const a: any = await VehicleAllotment.findById(id).lean();
  if (!a) throw new AppError("Allotment not found", 404);
  if (a.status !== "ACTIVE") throw new AppError("Only an active allotment can be extended", 409);
  const exp = istToDate(v.data.schedule.expectedReleaseDate, v.data.schedule.expectedReleaseTime);
  const nxt = istToDate(v.data.schedule.nextAvailableDate, v.data.schedule.nextAvailableTime); // optional
  if (exp && exp < a.allottedAt) throw new AppError("Expected release cannot be before the allotment date & time", 400);
  if (nxt && nxt < a.allottedAt) throw new AppError("Next available date & time cannot be before the allotment date & time", 400);

  const veh: any = await Vehicle.findById(a.vehicle).lean();
  if (!veh || veh.availability?.status !== "IN_USE" || veh.availability.project?.pifNumber !== a.pifNumber)
    throw new AppError("The vehicle's availability no longer matches this allotment; refresh and check Vehicle Management", 409);
  const p = veh.availability.project;
  const av = validateAvailability(availabilityInput(p, p.remarks ?? null, v.data.schedule), false, now, veh.availability);
  if (av.errors.length || !av.data) throw new AppError(av.errors.join("; "), 400);
  const rows = vehicleRows(veh.availability, av.data, veh._id, username, v.data.reason ?? "Project extended");
  if (!rows.length && +(nxt ?? 0) === +(a.nextAvailableAt ? new Date(a.nextAvailableAt) : 0) && +(exp ?? 0) === +(a.expectedReleaseAt ? new Date(a.expectedReleaseAt) : 0)) throw new AppError("No changes to save", 400);

  const upd = await Vehicle.findOneAndUpdate(
    { _id: veh._id, revision: veh.revision, "availability.status": "IN_USE", "availability.project.pifNumber": a.pifNumber },
    { $set: { availability: av.data, updatedBy: username }, $inc: { revision: 1 } }, { returnDocument: "after" },
  ).lean();
  if (!upd) throw new AppError("The vehicle was just changed by someone else; refresh and retry", 409);
  const res: any = await VehicleAllotment.findOneAndUpdate(
    { _id: a._id, status: "ACTIVE" }, { $set: { expectedReleaseAt: exp, nextAvailableAt: nxt, updatedBy: username } }, { returnDocument: "after" },
  ).lean();
  if (!res) {
    await restoreVehicle(veh._id, (upd as any).revision, veh.availability, username);
    throw new AppError("This allotment was just changed by someone else; refresh and retry", 409);
  }
  await syncDriverSchedule(res, username, now); // the driver's To date follows the allotment
  await logAllotment(a._id, "EXTENDED", username, {
    reason: v.data.reason, from: { expectedReleaseAt: a.expectedReleaseAt ?? null, nextAvailableAt: a.nextAvailableAt ?? null }, to: { expectedReleaseAt: exp, nextAvailableAt: nxt },
  });
  if (rows.length) await VehicleHistory.insertMany(rows);
  return withUrls(res);
}

/** Manual release: the vehicle becomes Available Now and the allotment ends (the scheduler does the same automatically). */
export async function releaseAllotment(id: string, input: unknown, username: string, now = new Date()) {
  if (!validId(id)) throw new AppError("Invalid allotment id", 400);
  const v = validateRelease(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const a: any = await VehicleAllotment.findById(id).lean();
  if (!a) throw new AppError("Allotment not found", 404);
  if (a.status !== "ACTIVE") throw new AppError("This allotment is already closed", 409);
  const reason = v.data.remarks ? `Released by RBP: ${v.data.remarks}` : "Released by RBP";
  const freed = await freeVehicle(a.vehicle, a.pifNumber, username, now);
  if (!freed) throw new AppError("The vehicle's availability no longer matches this allotment; refresh and check Vehicle Management", 409);
  const res: any = await VehicleAllotment.findOneAndUpdate(
    { _id: a._id, status: "ACTIVE" }, { $set: { status: "RELEASED", releasedAt: now, releaseReason: reason, updatedBy: username } }, { returnDocument: "after" },
  ).lean();
  if (!res) {
    await restoreVehicle(a.vehicle, freed.after.revision, freed.before.availability, username);
    throw new AppError("This allotment was just changed by someone else; refresh and retry", 409);
  }
  await logAllotment(a._id, "RELEASED", username, { reason, vehicleNo: a.vehicleNo, releasedAt: now });
  await releaseAllotmentDriver(a, { username, reason, at: now }); // the driver (if any) becomes Available Now with the vehicle
  const rows = vehicleRows(freed.before.availability, availableNowBlock(freed.before.availability, now), a.vehicle, username, reason);
  if (rows.length) await VehicleHistory.insertMany(rows);
  return withUrls(res);
}

export { joinAt };
