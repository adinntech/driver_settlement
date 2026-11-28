/* eslint-disable @typescript-eslint/no-explicit-any */
import { asVertical } from "../utils/vertical.js";
import { Driver, DriverHistory, DRIVER_AVAILABILITY_STATUSES } from "../models/Driver.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { validateDriver, type DriverData } from "../validators/driver.validator.js";
import { createWithDriverNumber } from "../utils/driverNumber.js";
import { attachmentUrl } from "./storage.service.js";
import { AppError } from "../utils/AppError.js";
import { diffVehicle, type Change } from "../validators/vehicle.validator.js";
import { validateDriverAvailability, type DriverAvailabilityData } from "../validators/driverAvailability.validator.js";
import { driverAvailabilityHistory, linkDriverProject, storedDriverAvailability } from "./driverAvailability.service.js";

const validId = (id: string) => /^[a-f0-9]{24}$/i.test(id);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

/** Computed on read: the attachment's public url is never stored. */
const withUrl = (d: any) => ({ ...d, attachment: d.attachment ? { ...d.attachment, url: attachmentUrl(d.attachment) } : null });

/** Friendly duplicate messages (the unique indexes are the final guard). */
async function duplicateCheck(data: DriverData, exceptId?: string) {
  const not = exceptId ? { _id: { $ne: exceptId } } : {};
  const byMobile: any = await Driver.findOne({ mobileDigits: data.mobileDigits, ...not }).select("driverNumber").lean();
  if (byMobile) throw new AppError(`A driver with mobile number ${data.mobileNumber} already exists (${byMobile.driverNumber})`, 409);
  if (data.licenceKey) {
    const byLic: any = await Driver.findOne({ licenceKey: data.licenceKey, ...not }).select("driverNumber").lean();
    if (byLic) throw new AppError(`A driver with licence number ${data.licenceNumber} already exists (${byLic.driverNumber})`, 409);
  }
}
function dupError(e: unknown): AppError | null {
  const kp = (e as { keyPattern?: Record<string, unknown> })?.keyPattern ?? {};
  if (!isDup(e)) return null;
  if ("mobileDigits" in kp) return new AppError("A driver with this mobile number already exists", 409);
  if ("licenceKey" in kp) return new AppError("A driver with this licence number already exists", 409);
  return null;
}

/**
 * Once a driver is saved its details are locked: only the bank details (and the operational Status / availability, which other
 * workflows manage) can change. Every other field sent in an update must equal the saved value, or the update is refused.
 */
export const LOCKED_DRIVER_FIELDS = [
  ["driverName", "Name"], ["driverType", "Driver type"], ["address", "Address"], ["mobileNumber", "Mobile number"],
  ["licenceNumber", "Licence number"], ["licenceType", "Licence type"], ["licenceExpiryDate", "Licence expiry date"],
  ["attachment", "Attachment"], ["salary", "Salary"],
] as const;

/** The saved driver as an update request would send it, so a bank-only request validates against the stored details. */
const asInput = (d: any) => ({
  driverName: d.driverName, driverType: d.driverType, address: d.address, mobileNumber: d.mobileNumber, accountName: d.accountName,
  accountNumber: d.accountNumber, ifscCode: d.ifscCode, bankName: d.bankName, licenceNumber: d.licenceNumber, licenceType: d.licenceType,
  licenceExpiryDate: d.licenceExpiryDate, salary: d.salary, status: d.status,
  attachment: d.attachment ? { storage: d.attachment.storage, key: d.attachment.key, name: d.attachment.name, size: d.attachment.size, mimeType: d.attachment.mimeType } : null,
});

/** Labels of locked fields whose value in `next` differs from the saved driver. */
export function lockedFieldChanges(existing: any, next: DriverData): string[] {
  const norm = (k: string, x: unknown): unknown => {
    if (x === undefined || x === null || x === "") return null;
    if (k === "attachment") return (x as { key?: string }).key ?? null;
    if (k === "salary") return Number(x) || 0;
    return x;
  };
  return LOCKED_DRIVER_FIELDS.filter(([k]) => norm(k, existing[k]) !== norm(k, (next as any)[k])).map(([, label]) => label);
}

const DETAIL_KEYS = ["driverName", "driverType", "address", "mobileNumber", "accountName", "accountNumber", "ifscCode", "bankName", "licenceNumber", "licenceType", "licenceExpiryDate", "salary", "status"] as const;

/** Resolves the approved project (read-only on RSOP data) and validates the availability block. */
async function checkAvailability(input: unknown, prev?: any) {
  const linked = await linkDriverProject(input, prev);
  const r = validateDriverAvailability(linked.input, new Date(), prev);
  if (linked.error) r.errors.unshift(linked.error);
  return r;
}

export async function createDriver(input: unknown, username: string) {
  const v = validateDriver(input);
  const rawAv = (input as any)?.availability;
  // a driver created without an availability block (older clients) starts as Available Now
  const av = await checkAvailability(rawAv === undefined || rawAv === null ? { status: "AVAILABLE" } : rawAv);
  const errors = [...v.errors, ...av.errors];
  if (errors.length || !v.data || !av.data) throw new AppError(errors.join("; "), 400);
  const data = v.data;
  const availability = av.data;
  await duplicateCheck(data);
  try {
    const doc: any = await createWithDriverNumber({
      exists: async (n) => !!(await Driver.exists({ driverNumber: n })),
      insert: (driverNumber) =>
        Driver.create({
          ...data, status: data.status ?? "ACTIVE", driverNumber, availability: storedDriverAvailability(availability, undefined, username), createdBy: username, updatedBy: username,
        }),
    });
    const empty = Object.fromEntries(DETAIL_KEYS.map((k) => [k, null]));
    await DriverHistory.create({ driver: doc._id, action: "CREATED", username, changes: diffVehicle(empty, { ...data, status: data.status ?? "ACTIVE" } as any, [...DETAIL_KEYS]) });
    const rows = driverAvailabilityHistory(undefined, availability, true);
    if (rows.length) await DriverHistory.insertMany(rows.map((r) => ({ ...r, driver: doc._id, username })));
    return withUrl(doc.toObject());
  } catch (e) {
    throw dupError(e) ?? e;
  }
}

/** The Driver Number is not editable: it is never read from the request and never regenerated. */
export async function updateDriver(id: string, input: unknown, username: string) {
  if (!validId(id)) throw new AppError("Invalid driver id", 400);
  const existing: any = await Driver.findById(id).lean();
  if (!existing) throw new AppError("Driver not found", 404);
  // Fields left out of the request keep their saved value; fields that are sent are checked against the lock below.
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const v = validateDriver({ ...asInput(existing), ...body });
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const locked = lockedFieldChanges(existing, v.data);
  if (locked.length)
    throw new AppError(`Driver details are locked after saving; only bank details can be changed. Not allowed: ${locked.join(", ")}`, 403);
  const data = { ...v.data, status: v.data.status ?? existing.status };
  const av = await checkAvailability((input as any)?.availability, existing.availability);
  if (av.errors.length) throw new AppError(av.errors.join("; "), 400);
  await duplicateCheck(data, id);
  const avRows = av.data ? driverAvailabilityHistory(existing.availability, av.data) : [];
  const heldBy = existing.availability?.status === "IN_USE" ? existing.availability.project?.allotment : null;
  if (avRows.length && heldBy && (await VehicleAllotment.exists({ _id: heldBy, activeDriver: id })))
    throw new AppError(`This driver is assigned to vehicle ${existing.availability.project.vehicleNo ?? ""} through Vehicle Allotment; use Change Driver or release the allotment there to change the availability`.replace("  ", " "), 409);
  const keys = DETAIL_KEYS;
  const norm = (x: unknown) => (x === undefined || x === null ? null : x);
  const same =
    keys.every((k) => norm((existing as any)[k]) === norm((data as any)[k])) &&
    JSON.stringify(norm(existing.attachment ? { ...existing.attachment } : null)) === JSON.stringify(norm(data.attachment));
  if (same && !avRows.length) throw new AppError("No changes to save", 400);
  const detailChanges: Change[] = diffVehicle(existing, data as any, [...keys]);
  try {
    // availability changes are guarded by its revision: if the scheduler (or another save) changed it meanwhile, nothing is overwritten
    const updated: any = await Driver.findOneAndUpdate(
      { _id: id, ...(avRows.length ? { "availability.revision": existing.availability?.revision ?? null } : {}) },
      { $set: { ...data, licenceNumber: data.licenceNumber, licenceKey: data.licenceKey, updatedBy: username, ...(av.data && avRows.length ? { availability: storedDriverAvailability(av.data as DriverAvailabilityData, existing.availability, username) } : {}) } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new AppError("This driver was changed by someone else (or by the automatic availability update); reload and try again", 409);
    if (detailChanges.length || !same) await DriverHistory.create({ driver: id, action: "UPDATED", username, changes: detailChanges });
    if (avRows.length) await DriverHistory.insertMany(avRows.map((r) => ({ ...r, driver: id, username })));
    return withUrl(updated);
  } catch (e) {
    throw dupError(e) ?? e;
  }
}

export async function getDriver(id: string) {
  if (!validId(id)) throw new AppError("Invalid driver id", 400);
  const d: any = await Driver.findById(id).lean();
  if (!d) throw new AppError("Driver not found", 404);
  return withUrl(d);
}

export interface DriverListQuery { projectType?: string; q?: string; availabilityStatus?: string; page?: number; limit?: number }

/** One mass search (driver number, name, mobile, licence number, driver type, project name, trackup / PIF number) combined with the status filter. */
export function driverFilter(q: DriverListQuery) {
  const and: any[] = [];
  const search = searchFilter((q.q ?? "").trim());
  if (search) and.push(search);
  if (q.availabilityStatus && (DRIVER_AVAILABILITY_STATUSES as readonly string[]).includes(q.availabilityStatus)) and.push({ "availability.status": q.availabilityStatus });
  if (asVertical(q.projectType)) and.push({ "availability.project.projectType": q.projectType }); // current assignment
  return and.length ? { $and: and } : {};
}

function searchFilter(raw: string) {
  if (!raw) return null;
  const rx = new RegExp(esc(raw), "i");
  const digits = raw.replace(/\D/g, "");
  const key = raw.toUpperCase().replace(/[\s\-/]/g, "");
  const or: any[] = [
    { driverNumber: rx }, { driverName: rx }, { licenceNumber: rx },
    { "availability.project.projectName": rx }, { "availability.project.trackupNumber": rx }, { "availability.project.pifNumber": rx },
  ];
  if (digits.length >= 2) {
    const national = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
    or.push({ mobileDigits: new RegExp(esc(national)) });
  }
  if (key.length >= 2) or.push({ licenceKey: new RegExp(esc(key), "i") });
  const t = raw.toLowerCase();
  if (t.length >= 3) {
    if ("company driver".includes(t)) or.push({ driverType: "COMPANY_DRIVER" });
    if ("acting driver".includes(t)) or.push({ driverType: "ACTING_DRIVER" });
  }
  return { $or: or };
}

export async function listDrivers(q: DriverListQuery) {
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const filter = driverFilter(q);
  const [items, total] = await Promise.all([
    Driver.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Driver.countDocuments(filter),
  ]);
  return { items: items.map(withUrl), total, page, limit };
}

/** Latest first. */
export async function driverHistory(id: string, asc = false) {
  if (!validId(id)) throw new AppError("Invalid driver id", 400);
  const dir = asc ? 1 : -1;
  return DriverHistory.find({ driver: id }).sort({ createdAt: dir, _id: dir }).lean();
}
