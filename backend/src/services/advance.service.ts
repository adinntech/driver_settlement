/* eslint-disable @typescript-eslint/no-explicit-any */
import { Driver } from "../models/Driver.js";
import { DriverAdvance } from "../models/DriverAdvance.js";
import { ROUNDING_METHOD, ROUNDING_UNIT, calculateAdvance, isValidWorkingDays, MAX_WORKING_DAYS } from "../utils/advance.js";
import { AppError } from "../utils/AppError.js";

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Only working days and the idempotency key are read from the request. Every amount is calculated here, from the saved salary. */
export function validateAdvanceInput(input: unknown): { errors: string[]; data: { workingDays: number; idempotencyKey: string } | null } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  let workingDays: number | null = null;
  const raw = b.workingDays;
  const n = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (raw === undefined || raw === null || raw === "") errors.push("Overall working days is required");
  else if (!isValidWorkingDays(n)) errors.push(`Overall working days must be a whole number between 1 and ${MAX_WORKING_DAYS}`);
  else workingDays = n;
  if (typeof b.idempotencyKey !== "string" || !KEY.test(b.idempotencyKey)) errors.push("A valid submission key is required");
  return errors.length || workingDays === null ? { errors, data: null } : { errors, data: { workingDays, idempotencyKey: b.idempotencyKey as string } };
}

const view = (a: any) => ({
  _id: String(a._id), driver: String(a.driver), driverNumber: a.driverNumber, driverName: a.driverName, workingDays: a.workingDays, perDaySalary: a.perDaySalary,
  eligibleAdvanceAmount: a.eligibleAdvanceAmount, calculatedHalfAmount: a.calculatedHalfAmount, finalAdvanceAmount: a.finalAdvanceAmount, roundingUnit: a.roundingUnit,
  roundingMethod: a.roundingMethod, submittedBy: a.submittedBy, submittedAt: a.submittedAt, createdAt: a.createdAt, idempotencyKey: a.idempotencyKey,
});

/**
 * Submits an advance for a driver. The driver's saved salary is read here and the whole calculation is done again on the server,
 * so a tampered request cannot change any amount. The same idempotency key returns the already saved advance instead of a second one.
 */
export async function submitAdvance(driverId: string, input: unknown, username: string, now = new Date()): Promise<{ advance: ReturnType<typeof view>; replay: boolean }> {
  if (!validId(driverId)) throw new AppError("Invalid driver id", 400);
  const v = validateAdvanceInput(input);
  if (v.errors.length || !v.data) throw new AppError(v.errors.join("; "), 400);
  const d: any = await Driver.findById(driverId).select("driverNumber driverName salary").lean();
  if (!d) throw new AppError("Driver not found", 404);

  const existing: any = await DriverAdvance.findOne({ driver: d._id, idempotencyKey: v.data.idempotencyKey }).lean();
  if (existing) {
    if (existing.workingDays !== v.data.workingDays) throw new AppError("This submission key was already used for a different advance", 409);
    return { advance: view(existing), replay: true };
  }
  const salary = Number(d.salary);
  if (!Number.isFinite(salary) || salary <= 0) throw new AppError("Driver salary is unavailable; set the driver's salary in Driver Management first", 400);
  const c = calculateAdvance(v.data.workingDays, salary);
  if (c.finalAdvanceAmount <= 0) throw new AppError(`The eligible amount is too low for an advance (half of it must be at least ${ROUNDING_UNIT})`, 400);

  try {
    const doc: any = await DriverAdvance.create({
      driver: d._id, driverNumber: d.driverNumber, driverName: d.driverName, workingDays: c.workingDays, perDaySalary: c.perDaySalary,
      eligibleAdvanceAmount: c.eligibleAdvanceAmount, calculatedHalfAmount: c.calculatedHalfAmount, finalAdvanceAmount: c.finalAdvanceAmount,
      roundingUnit: ROUNDING_UNIT, roundingMethod: ROUNDING_METHOD, submittedBy: username, submittedAt: now, idempotencyKey: v.data.idempotencyKey,
    });
    return { advance: view(doc.toObject()), replay: false };
  } catch (e) {
    if (!isDup(e)) throw e;
    // a simultaneous request with the same key won the race: return its record
    const won: any = await DriverAdvance.findOne({ driver: d._id, idempotencyKey: v.data.idempotencyKey }).lean();
    if (!won) throw e;
    return { advance: view(won), replay: true };
  }
}

/** Advance history of one driver, latest first, paginated on the server. */
export async function listAdvances(driverId: string, q: { page?: number; limit?: number }) {
  if (!validId(driverId)) throw new AppError("Invalid driver id", 400);
  if (!(await Driver.exists({ _id: driverId }))) throw new AppError("Driver not found", 404);
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const [items, total] = await Promise.all([
    DriverAdvance.find({ driver: driverId }).sort({ submittedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    DriverAdvance.countDocuments({ driver: driverId }),
  ]);
  return { items: items.map(view), total, page, limit };
}

export async function getAdvance(driverId: string, advanceId: string) {
  if (!validId(driverId)) throw new AppError("Invalid driver id", 400);
  if (!validId(advanceId)) throw new AppError("Invalid advance id", 400);
  const a: any = await DriverAdvance.findOne({ _id: advanceId, driver: driverId }).lean(); // an advance of another driver is never returned
  if (!a) throw new AppError("Advance not found", 404);
  return view(a);
}
