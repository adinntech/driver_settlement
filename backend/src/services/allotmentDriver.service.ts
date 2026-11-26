/* eslint-disable @typescript-eslint/no-explicit-any */
import { Driver, DriverHistory } from "../models/Driver.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { istNowAt, istParts } from "../validators/availability.validator.js";
import { parseAttachments } from "../validators/allotment.validator.js";
import { driverAvailabilityHistory, storedDriverAvailability } from "./driverAvailability.service.js";
import { dateToIst, logAllotment } from "./allotment.core.js";
import { attachmentUrl, type Attachment } from "./storage.service.js";
import { AppError } from "../utils/AppError.js";
import { diffVehicle } from "../validators/vehicle.validator.js";
import { BANK_FIELDS, maskAccount, parseTravelDeduction, validateBank, type BankData } from "../validators/driverBank.validator.js";

/**
 * Driver assignment inside Vehicle Allotment. Driver records stay owned by Driver Management; this module only moves a driver
 * between "Available Now" and "In Use – Another Project" and records the link on the allotment.
 * The standalone MongoDB has no multi-document transactions, so every step is an atomic conditional update and every failure
 * after a first step puts it back exactly as it was (the same compensation pattern the vehicle allotment already uses).
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
const str = (v: unknown) => (v ? String(v) : null);

const snapshot = (d: any) => ({ driverNumber: d.driverNumber as string, driverName: d.driverName as string, driverType: d.driverType as string, driverMobile: d.mobileNumber as string });
const eventDriver = (d: any) => ({ driverId: String(d._id ?? d.driver), driverNumber: d.driverNumber, driverName: d.driverName, driverType: d.driverType, mobileNumber: d.mobileNumber ?? d.driverMobile });

/** Why a driver cannot be assigned right now (null = can be). Only an active driver explicitly confirmed "Available Now" qualifies. */
export function driverUnavailableReason(d: any, now: Date): string | null {
  if (!d) return "Driver not found";
  const who = `Driver ${d.driverNumber}`;
  if (d.status !== "ACTIVE") return `${who} is ${String(d.status).toLowerCase()}; only active drivers can be assigned`;
  const a = d.availability;
  if (!a?.status) return `${who}'s availability is not confirmed; set it in Driver Management first`;
  if (a.status === "IN_USE") return `${who} is already in use on another project`;
  if (a.status === "NOT_AVAILABLE") return `${who} is not available${a.notAvailable?.reason ? `: ${a.notAvailable.reason}` : ""}`;
  const from = a.availableFromDate ? `${a.availableFromDate}T${a.availableFromTime ?? "00:00"}` : null;
  if (from && from > istNowAt(now)) return `${who} is available only from ${a.availableFromDate} ${a.availableFromTime ?? ""}`.trim();
  return null;
}

// ---------------------------------------------------------------- queries

/** Drivers that can be assigned right now (Available Now, active, past their available-from moment, holding no allotment). */
export async function searchAvailableDrivers(q: string, limit = 10, now = new Date()) {
  const lim = Math.min(Math.max(limit, 1), 25);
  const p = istParts(now);
  const busy = await VehicleAllotment.find({ activeDriver: { $type: "objectId" } }).distinct("activeDriver");
  const and: any[] = [
    { status: "ACTIVE", "availability.status": "AVAILABLE", _id: { $nin: busy } },
    { $or: [{ "availability.availableFromDate": { $lt: p.date } }, { "availability.availableFromDate": p.date, "availability.availableFromTime": { $lte: p.time } }, { "availability.availableFromDate": null }] },
  ];
  const term = q.trim();
  if (term) {
    const rx = new RegExp(esc(term), "i");
    and.push({ $or: [{ driverNumber: rx }, { driverName: rx }] });
  }
  const items = await Driver.find({ $and: and }).select("driverNumber driverName driverType mobileNumber").sort({ driverNumber: 1 }).limit(lim).lean();
  return items.map((d: any) => ({ _id: String(d._id), driverNumber: d.driverNumber, driverName: d.driverName, driverType: d.driverType, mobileNumber: d.mobileNumber }));
}

/**
 * Exact lookup for the two-way mapping: a Driver Number gives its name, a Driver Name gives its number.
 * Only an assignable ("Available Now") driver resolves. A name shared by several available drivers is ambiguous and must be
 * chosen from the suggestions (by Driver Number).
 */
export async function lookupAvailableDriver(by: { number?: string; name?: string }, now = new Date()) {
  const number = (by.number ?? "").trim().toUpperCase();
  const name = (by.name ?? "").trim().replace(/\s+/g, " ");
  if (!number && !name) throw new AppError("Enter a Driver Number or Driver Name", 400);
  const filter: any = number ? { driverNumber: number } : { driverName: new RegExp(`^${esc(name)}$`, "i") };
  const found: any[] = await Driver.find(filter).limit(25).lean();
  if (!found.length) throw new AppError(number ? `Driver number ${number} was not found` : `No driver named ${name} was found`, 404);
  const busy = new Set((await VehicleAllotment.find({ activeDriver: { $in: found.map((d) => d._id) } }).select("activeDriver").lean()).map((a: any) => String(a.activeDriver)));
  const ok = found.filter((d) => !driverUnavailableReason(d, now) && !busy.has(String(d._id)));
  if (!ok.length) {
    const d = found[0];
    throw new AppError(busy.has(String(d._id)) ? `Driver ${d.driverNumber} is already assigned to another vehicle` : (driverUnavailableReason(d, now) as string), 409);
  }
  if (ok.length > 1) throw new AppError(`More than one available driver is named ${name}; choose one from the suggestions by Driver Number`, 409);
  const d = ok[0];
  return { _id: String(d._id), driverNumber: d.driverNumber, driverName: d.driverName, driverType: d.driverType, mobileNumber: d.mobileNumber };
}

// ---------------------------------------------------------------- driver availability blocks

/** Fields of an allotment (or the allotment about to be created) that the driver's allocation mirrors. */
interface AllotmentLike {
  project: unknown; trackingVehicle: unknown; budget?: unknown; budgetVersion?: number | null; projectType?: string; projectName?: string; clientName?: string;
  trackupNumber: string; pifNumber: string; allottedAt: Date; nextAvailableAt: Date | null; expectedReleaseAt?: Date | null; projectEnd?: string | null; remarks?: string | null; vehicle: unknown; vehicleNo?: string;
}

/**
 * The driver's To date: the allotment's next-available day; when that optional moment is not set, the expected release day,
 * then the project end date, then the allotment day itself.
 */
export function driverEndDate(a: Pick<AllotmentLike, "nextAvailableAt" | "expectedReleaseAt" | "projectEnd" | "allottedAt">): string {
  return dateToIst(a.nextAvailableAt ?? null)?.date ?? dateToIst(a.expectedReleaseAt ?? null)?.date ?? (a.projectEnd || dateToIst(a.allottedAt)!.date);
}

/** "In Use – Another Project" for the driver: From = allotment day, To = the day the allotment ends (IST). The driver scheduler releases after To. */
export function driverInUseBlock(a: AllotmentLike, allotmentId: unknown): any {
  return {
    status: "IN_USE", availableFromDate: null, availableFromTime: null, notAvailable: null,
    project: {
      trackingProject: str(a.project), trackingVehicle: str(a.trackingVehicle), budget: str(a.budget), budgetVersion: a.budgetVersion ?? null,
      projectType: a.projectType ?? null, projectName: a.projectName ?? null, clientName: a.clientName ?? null, trackupNumber: a.trackupNumber, pifNumber: a.pifNumber,
      startDate: dateToIst(a.allottedAt)!.date, endDate: driverEndDate(a), remarks: a.remarks ?? null,
      allotment: str(allotmentId), vehicle: str(a.vehicle), vehicleNo: a.vehicleNo ?? null,
    },
  };
}

const availableNowBlock = (at: Date): any => {
  const p = istParts(at);
  return { status: "AVAILABLE", availableFromDate: p.date, availableFromTime: p.time, project: null, notAvailable: null };
};

/** Atomically takes an Available Now driver. Null when the driver changed in the meantime (another RBP user got there first). */
export async function reserveDriver(d: any, block: any, username: string, now: Date): Promise<any | null> {
  return Driver.findOneAndUpdate(
    { _id: d._id, status: "ACTIVE", "availability.status": "AVAILABLE", "availability.revision": d.availability?.revision ?? null },
    { $set: { availability: storedDriverAvailability(block, d.availability, username, now) } },
    { returnDocument: "after" },
  ).lean();
}

/** Puts a driver back exactly as it was (compensation); guarded by the revision we produced so it never clobbers newer changes. */
export const restoreDriver = (driverId: unknown, revision: number, prev: any, username: string) =>
  Driver.updateOne({ _id: driverId, "availability.revision": revision }, { $set: { availability: { ...prev, revision: revision + 1, lastStatusUpdatedBy: username, lastStatusUpdatedAt: new Date() } } });

/** Driver history rows for a driver availability move caused by an allotment (always append-only). */
const driverRows = (prev: any, next: any, driver: unknown, username: string, reason: string) =>
  driverAvailabilityHistory(prev, next).map((r) => ({ ...r, driver, username, reason }));

/**
 * Releases a driver that is held by this allotment: In Use -> Available Now. Conditional on the driver still being on exactly this
 * allotment, so a driver that has since been re-assigned or set Not Available is never touched. Null = nothing to release.
 */
async function releaseDriverNow(driverId: unknown, allotmentId: unknown, o: { username: string; reason: string; at: Date; auto: boolean }) {
  const cur: any = await Driver.findById(driverId).lean();
  if (!cur || cur.availability?.status !== "IN_USE" || String(cur.availability.project?.allotment ?? "") !== String(allotmentId)) return null;
  const next = availableNowBlock(o.at);
  const after: any = await Driver.findOneAndUpdate(
    { _id: driverId, "availability.status": "IN_USE", "availability.project.allotment": allotmentId, "availability.revision": cur.availability.revision ?? null },
    { $set: { availability: { ...storedDriverAvailability(next, cur.availability, o.username, o.at), ...(o.auto ? { autoReleasedAt: o.at } : {}) } } },
    { returnDocument: "after" },
  ).lean();
  if (!after) return null;
  const rows = driverRows(cur.availability, next, driverId, o.username, o.reason).map((r) =>
    o.auto ? { ...r, action: "AUTO_AVAILABILITY_UPDATE", autoKey: `${driverId}:allotment:${allotmentId}` } : { ...r, action: "STATUS_CHANGED" });
  try {
    if (rows.length) await DriverHistory.insertMany(rows);
  } catch (e) {
    if (!isDup(e)) throw e; // the automatic release was already recorded by an earlier run
  }
  return { before: cur, after };
}

/**
 * The allotment ended (released manually, by the scheduler, or from the vehicle form): its driver becomes Available Now.
 * Idempotent. The allotment keeps the driver's details; only the active hold is cleared. Called after the allotment row is closed.
 */
export async function releaseAllotmentDriver(a: any, o: { username: string; reason: string; at?: Date }): Promise<boolean> {
  if (!a?.activeDriver) return false;
  const at = o.at ?? new Date();
  await releaseDriverNow(a.activeDriver, a._id, { username: o.username, reason: o.reason, at, auto: o.username === "SYSTEM" });
  const done = await VehicleAllotment.updateOne({ _id: a._id, activeDriver: a.activeDriver }, { $unset: { activeDriver: 1 }, $set: { driverReleasedAt: at } });
  if (!done.modifiedCount) return false;
  await logAllotment(a._id, "DRIVER_RELEASED", o.username, { ...eventDriver(a), reason: o.reason, releasedAt: at });
  return true;
}

/** The allotment's end moment changed (project extension): the driver's To date follows, and the old date's scheduled release cannot fire. */
export async function syncDriverSchedule(a: any, username: string, now = new Date()): Promise<void> {
  if (!a?.activeDriver) return;
  const cur: any = await Driver.findById(a.activeDriver).lean();
  if (!cur || cur.availability?.status !== "IN_USE" || String(cur.availability.project?.allotment ?? "") !== String(a._id)) return;
  const endDate = driverEndDate(a);
  if (cur.availability.project.endDate === endDate) return;
  const next = { ...cur.availability, project: { ...cur.availability.project, endDate } };
  const upd = await Driver.findOneAndUpdate(
    { _id: cur._id, "availability.status": "IN_USE", "availability.project.allotment": a._id, "availability.revision": cur.availability.revision ?? null },
    { $set: { "availability.project.endDate": endDate, "availability.revision": (cur.availability.revision ?? 0) + 1, "availability.lastStatusUpdatedBy": username, "availability.lastStatusUpdatedAt": now } },
    { returnDocument: "after" },
  ).lean();
  if (!upd) return;
  const rows = driverRows(cur.availability, next, cur._id, username, `Project schedule changed on vehicle ${a.vehicleNo ?? ""}`.trim());
  if (rows.length) await DriverHistory.insertMany(rows);
}

// ---------------------------------------------------------------- commands

const text = (o: Record<string, unknown>, k: string, label: string, max: number, errors: string[], required = false): string | null => {
  const v = o[k];
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (required) errors.push(`${label} is required`);
    return null;
  }
  if (typeof v !== "string") {
    errors.push(`${label} is invalid`);
    return null;
  }
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length > max) errors.push(`${label} is too long (max ${max})`);
  // eslint-disable-next-line no-control-regex -- intentionally rejects control characters in free text
  else if (!/^[^<>\u0000-\u001f\u007f]+$/u.test(t)) errors.push(`${label} contains invalid characters`);
  return t;
};

export function validateAssignDriver(input: unknown): { errors: string[]; data: { driverId: string; remarks: string | null } | null } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (!validId(b.driverId)) errors.push("Driver is required");
  const remarks = text(b, "remarks", "Remarks", 300, errors);
  return errors.length ? { errors, data: null } : { errors, data: { driverId: b.driverId as string, remarks } };
}

export function validateChangeDriver(input: unknown): { errors: string[]; data: { driverId: string; reason: string; remarks: string | null; attachments: Attachment[]; travelAmountDeduction: number } | null } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (!validId(b.driverId)) errors.push("Replacement driver is required");
  const reason = text(b, "reason", "Change reason", 300, errors, true);
  const remarks = text(b, "remarks", "Additional remarks", 300, errors);
  const attachments = parseAttachments(b.attachments, errors);
  const ded = parseTravelDeduction(b.travelAmountDeduction); // specific to Change Driver; records the amount only
  if (ded.error) errors.push(ded.error);
  return errors.length || !reason ? { errors, data: null } : { errors, data: { driverId: b.driverId as string, reason, remarks, attachments, travelAmountDeduction: ded.value } };
}

const withUrls = (a: any) => ({ ...a, changeAttachments: (a.changeAttachments ?? []).map((x: any) => ({ ...x, url: attachmentUrl(x) })) });
export const driverFields = (d: any, username: string, at: Date) => ({
  driver: d._id, activeDriver: d._id, ...snapshot(d), driverAssignedAt: at, driverAssignedBy: username, updatedBy: username,
});

// ---------------------------------------------------------------- bank details (assignment time)

const bankOf = (d: any): BankData => ({ accountName: d?.accountName ?? null, bankName: d?.bankName ?? null, accountNumber: d?.accountNumber ?? null, ifscCode: d?.ifscCode ?? null });
/** Point-in-time copy for history: the account number is masked, so later bank edits never alter it and no full number is logged. */
export const bankSnapshot = (d: any) => {
  const b = bankOf(d);
  return { accountName: b.accountName, bankName: b.bankName, accountNumberMasked: maskAccount(b.accountNumber), ifscCode: b.ifscCode, hasBankDetails: !!(b.accountName || b.bankName || b.accountNumber || b.ifscCode) };
};
const bankView = (d: any) => ({ driverId: String(d._id), driverNumber: d.driverNumber, driverName: d.driverName, ...bankOf(d), accountNumberMasked: maskAccount(d.accountNumber), hasBankDetails: bankSnapshot(d).hasBankDetails });

/** Saved bank details of a driver (RBP only). The full number is returned only here, for the edit form; lists and history use the masked value. */
export async function getDriverBank(driverId: string) {
  if (!validId(driverId)) throw new AppError("Invalid driver id", 400);
  const d: any = await Driver.findById(driverId).select("driverNumber driverName accountName bankName accountNumber ifscCode").lean();
  if (!d) throw new AppError("Driver not found", 404);
  return bankView(d);
}

/**
 * Edits the bank details of ONE driver during an assignment / change of the given allotment. Only that driver's four bank fields are
 * written (nothing else on the driver). The driver must be the allotment's current driver or an assignable (Available Now) driver.
 * The previous and new values are recorded (account numbers masked) in the driver's history and the allotment's activity trail.
 */
export async function updateDriverBank(allotmentId: string, driverId: string, input: unknown, username: string, now = new Date()) {
  if (!validId(allotmentId)) throw new AppError("Invalid allotment id", 400);
  if (!validId(driverId)) throw new AppError("Invalid driver id", 400);
  const v = validateBank(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const a: any = await VehicleAllotment.findById(allotmentId).lean();
  if (!a) throw new AppError("Allotment not found", 404);
  if (a.status !== "ACTIVE") throw new AppError("Bank details can only be edited while assigning a driver to an active allotment", 409);
  const d: any = await Driver.findById(driverId).lean();
  if (!d) throw new AppError("Driver not found", 404);
  const isCurrent = a.activeDriver && String(a.activeDriver) === driverId;
  if (!isCurrent) {
    const why = driverUnavailableReason(d, now);
    if (why) throw new AppError(why, 409);
  }
  const before = bankOf(d);
  const changes = diffVehicle(before as any, v.data as any, [...BANK_FIELDS]);
  if (!changes.length) throw new AppError("No changes to save", 400);
  const upd: any = await Driver.findOneAndUpdate({ _id: d._id }, { $set: { ...v.data, updatedBy: username } }, { returnDocument: "after" }).lean();
  if (!upd) throw new AppError("Driver not found", 404);
  const shown = changes.map((c) => (c.field === "accountNumber" ? { ...c, from: maskAccount(c.from as string | null), to: maskAccount(c.to as string | null) } : c));
  await DriverHistory.create({
    driver: d._id, action: "BANK_UPDATED", username, changes: shown,
    reason: `Bank details updated during driver assignment on vehicle ${a.vehicleNo} (${a.trackupNumber})`,
  });
  await logAllotment(a._id, "DRIVER_BANK_UPDATED", username, { ...eventDriver(d), changes: shown, updatedAt: now });
  return bankView(upd);
}

/** Assign Driver later: links an Available Now driver to an active allotment that has none. The vehicle allotment itself is untouched. */
export async function assignDriver(allotmentId: string, input: unknown, username: string, now = new Date()) {
  if (!validId(allotmentId)) throw new AppError("Invalid allotment id", 400);
  const v = validateAssignDriver(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const a: any = await VehicleAllotment.findById(allotmentId).lean();
  if (!a) throw new AppError("Allotment not found", 404);
  if (a.status !== "ACTIVE") throw new AppError("A driver can only be assigned to an active allotment", 409);
  if (a.activeDriver) throw new AppError(`Driver ${a.driverNumber} is already assigned to this allotment; use Change Driver`, 409);
  const d: any = await Driver.findById(v.data.driverId).lean();
  const why = driverUnavailableReason(d, now);
  if (why) throw new AppError(why, d ? 409 : 404);
  if (await VehicleAllotment.exists({ activeDriver: d._id })) throw new AppError(`Driver ${d.driverNumber} is already assigned to another vehicle`, 409);

  const reserved = await reserveDriver(d, driverInUseBlock(a, a._id), username, now);
  if (!reserved) throw new AppError(`Driver ${d.driverNumber} is no longer available`, 409);
  let upd: any;
  try {
    upd = await VehicleAllotment.findOneAndUpdate(
      { _id: a._id, status: "ACTIVE", activeDriver: { $exists: false } },
      { $set: driverFields(d, username, now), $unset: { driverReleasedAt: 1 } }, { returnDocument: "after" },
    ).lean();
  } catch (e) {
    await restoreDriver(d._id, reserved.availability.revision, d.availability, username);
    if (isDup(e)) throw new AppError(`Driver ${d.driverNumber} was just assigned to another vehicle`, 409);
    throw e;
  }
  if (!upd) {
    await restoreDriver(d._id, reserved.availability.revision, d.availability, username);
    throw new AppError("This allotment was just changed by someone else; refresh and retry", 409);
  }
  const fresh: any = await Driver.findById(d._id).select("accountName bankName accountNumber ifscCode").lean(); // includes any edit made in the dialog
  await logAllotment(a._id, "DRIVER_ASSIGNED", username, { ...eventDriver(d), vehicleNo: a.vehicleNo, trackupNumber: a.trackupNumber, assignedAt: now, remarks: v.data.remarks, later: true, bank: bankSnapshot(fresh) });
  const rows = driverRows(d.availability, driverInUseBlock(a, a._id), d._id, username, `Assigned to vehicle ${a.vehicleNo} (${a.trackupNumber})`);
  if (rows.length) await DriverHistory.insertMany(rows);
  return withUrls(upd);
}

/**
 * Change Driver: the replacement is taken first (atomic), then the allotment switches to it (guarded on the current driver), then the
 * previous driver is released. A failure before the switch restores the replacement and leaves the existing assignment untouched.
 */
export async function changeDriver(allotmentId: string, input: unknown, username: string, now = new Date()) {
  if (!validId(allotmentId)) throw new AppError("Invalid allotment id", 400);
  const v = validateChangeDriver(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const a: any = await VehicleAllotment.findById(allotmentId).lean();
  if (!a) throw new AppError("Allotment not found", 404);
  if (a.status !== "ACTIVE") throw new AppError("The driver of a closed allotment cannot be changed", 409);
  if (!a.activeDriver) throw new AppError("No driver is assigned to this allotment; use Assign Driver", 409);
  if (String(a.activeDriver) === v.data.driverId) throw new AppError("Choose a different driver as the replacement", 400);
  const d: any = await Driver.findById(v.data.driverId).lean();
  const why = driverUnavailableReason(d, now);
  if (why) throw new AppError(why, d ? 409 : 404);
  if (await VehicleAllotment.exists({ activeDriver: d._id })) throw new AppError(`Driver ${d.driverNumber} is already assigned to another vehicle`, 409);

  const reserved = await reserveDriver(d, driverInUseBlock(a, a._id), username, now);
  if (!reserved) throw new AppError(`Driver ${d.driverNumber} is no longer available; the current driver is unchanged`, 409);
  let upd: any;
  try {
    upd = await VehicleAllotment.findOneAndUpdate(
      { _id: a._id, status: "ACTIVE", activeDriver: a.activeDriver },
      { $set: driverFields(d, username, now), $unset: { driverReleasedAt: 1 } }, { returnDocument: "after" },
    ).lean();
  } catch (e) {
    await restoreDriver(d._id, reserved.availability.revision, d.availability, username);
    if (isDup(e)) throw new AppError(`Driver ${d.driverNumber} was just assigned to another vehicle; the current driver is unchanged`, 409);
    throw e;
  }
  if (!upd) {
    await restoreDriver(d._id, reserved.availability.revision, d.availability, username);
    throw new AppError("This allotment was just changed by someone else; the current driver is unchanged, refresh and retry", 409);
  }
  const reason = `Replaced by ${d.driverNumber}: ${v.data.reason}${v.data.travelAmountDeduction > 0 ? ` (travel amount deduction ${v.data.travelAmountDeduction})` : ""}`;
  const [oldBank, newBank]: any[] = await Promise.all([
    Driver.findById(a.activeDriver).select("accountName bankName accountNumber ifscCode").lean(),
    Driver.findById(d._id).select("accountName bankName accountNumber ifscCode").lean(), // includes any edit made in the dialog
  ]);
  await releaseDriverNow(a.activeDriver, a._id, { username, reason, at: now, auto: false }); // the previous driver is Available Now again
  await logAllotment(a._id, "DRIVER_CHANGED", username, {
    from: eventDriver(a), to: eventDriver(d), vehicleNo: a.vehicleNo, reason: v.data.reason, remarks: v.data.remarks, attachments: v.data.attachments, changedAt: now,
    travelAmountDeduction: v.data.travelAmountDeduction, fromBank: bankSnapshot(oldBank), toBank: bankSnapshot(newBank),
  });
  const rows = driverRows(d.availability, driverInUseBlock(a, a._id), d._id, username, `Assigned as replacement for ${a.driverNumber} on vehicle ${a.vehicleNo}: ${v.data.reason}`);
  if (rows.length) await DriverHistory.insertMany(rows);
  return withUrls(upd);
}

/** Driver block for the allotment detail view: the allotment's snapshot plus the driver's live status. Null = Driver Not Assigned. */
export async function allotmentDriverView(a: any) {
  if (!a?.driver) return null;
  const d: any = await Driver.findById(a.driver).select("driverNumber driverName driverType mobileNumber availability.status").lean();
  return {
    driverId: String(a.driver), active: !!a.activeDriver, driverNumber: a.driverNumber ?? d?.driverNumber ?? null, driverName: a.driverName ?? d?.driverName ?? null,
    driverType: a.driverType ?? d?.driverType ?? null, mobileNumber: a.driverMobile ?? d?.mobileNumber ?? null, assignedAt: a.driverAssignedAt ?? null,
    assignedBy: a.driverAssignedBy ?? null, releasedAt: a.driverReleasedAt ?? null, status: d?.availability?.status ?? null,
  };
}
