/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { countedHistorical, describeHistorical, HistoricalSuspense } from "../models/HistoricalSuspense.js";
import { ENTRY_PAYMENT_MODES, SettlementPayment } from "../models/SettlementPayment.js";
import { AppError } from "../utils/AppError.js";
import { isYmd, todayIst } from "../utils/dates.js";
import { validatePaymentInput } from "../utils/rsaPayment.js";
import { dailyData } from "../utils/settlement.js";
import { projectContext } from "./rsa.service.js";
import { assertReferenceFree, recordPreviousData, refLock, withLock } from "./settlement.service.js";
import { suspenseFor } from "./paymentDetailsPdf.service.js";

const SAFE_TEXT = /^[^<>\p{Cc}]+$/u; // no markup or control characters
const REFERENCE = /^[A-Za-z0-9/_-]{1,60}$/;
const paise = (n: unknown) => Math.round((Number(n) || 0) * 100);
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

/** Nothing is defaulted or guessed: every historical value must be given as it was. Names and ids are never taken from here. */
function validate(input: unknown, today = todayIst()) {
  const b = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  // every previous-data expense is part of the amount paid: there is no deduction option here
  const expenses = Array.isArray(b.expenses) ? b.expenses.map((e) => ({ ...(e as object), deduct: false })) : b.expenses;
  const money = validatePaymentInput({ ...b, expenses, paymentFor: undefined });
  const errors = money.errors.map((e) => e.replace(/Diesel entry \d+/g, "Fuel Amount").replace("(diesel,", "(fuel,"));
  const date = (k: string, label: string): string => {
    const v = b[k];
    if (!isYmd(v)) errors.push(`${label} is required (YYYY-MM-DD)`);
    else if (v > today) errors.push(`${label} cannot be in the future`);
    return String(v ?? "");
  };
  const text = (k: string, label: string, max: number, required: boolean): string => {
    const v = typeof b[k] === "string" ? (b[k] as string).trim().replace(/\s+/g, " ") : "";
    if (!v) {
      if (required) errors.push(`${label} is required`);
    } else if (v.length > max || !SAFE_TEXT.test(v)) errors.push(`${label} is invalid (max ${max} characters)`);
    return v;
  };
  const fromDate = date("fromDate", "From Date");
  const toDate = date("toDate", "To Date");
  if (isYmd(fromDate) && isYmd(toDate) && toDate < fromDate) errors.push("To Date cannot be before From Date");
  const paymentDate = date("paymentDate", "Payment Date");
  const paymentMode = String(b.paymentMode ?? "");
  if (!(ENTRY_PAYMENT_MODES as readonly string[]).includes(paymentMode)) errors.push("Choose the Payment Mode");
  const referenceNumber = typeof b.referenceNumber === "string" ? b.referenceNumber.trim() : "";
  if (!REFERENCE.test(referenceNumber)) errors.push("Reference No. / UTR is required (letters, digits, / - _, max 60)");
  const bankName = text("bankName", "Bank Name", 120, false);
  const sourceDetails = text("sourceDetails", "Source Details", 200, false);
  const remarks = text("remarks", "Remarks", 500, false);
  if (errors.length || !money.data) throw new AppError(errors.join("; "), 400);
  const data = dailyData({ ...money.data, fromDate, toDate, paymentFor: "SIGNAGE" } as any);
  if (!(data.totalPayable > 0)) throw new AppError("The total of the amounts must be greater than zero", 400);
  return {
    key: money.data.idempotencyKey,
    values: { fromDate, toDate, paymentDate, paymentMode, referenceNumber, bankName: bankName || undefined, sourceDetails, remarks: remarks || undefined, data, amount: data.totalPayable },
  };
}

const shape = (h: any) => ({
  _id: String(h._id), entryId: String(h.entryId), revision: h.revision, status: h.status, source: h.source, fromDate: h.fromDate, toDate: h.toDate,
  paymentDate: h.paymentDate, paymentMode: h.paymentMode, bankName: h.bankName || null, referenceNumber: h.referenceNumber, amount: h.amount, data: h.data,
  sourceDetails: h.sourceDetails, remarks: h.remarks || null, correctionReason: h.correctionReason || null,
  trackupNumber: h.trackupNumber, pifNumber: h.pifNumber, vehicleNo: h.vehicleNo, driverNumber: h.driverNumber, driverName: h.driverName,
  createdBy: h.createdBy, createdByRole: h.createdByRole, createdAt: h.createdAt, updatedBy: h.updatedBy || null, submittedBy: h.submittedBy || null, submittedAt: h.submittedAt || null,
});

/** The counted entries of one driver on one project vehicle (what clearance and the other read-only screens show). */
export const historicalFor = async (trackingVehicle: unknown, driver: unknown) => (await countedHistorical(trackingVehicle, driver)).map(shape);

/** Every entry of the allotted driver with its revision history, latest first inside each. Drafts are RSA's own. */
export async function listHistorical(tvId: string, role: string) {
  const ctx = await projectContext(tvId);
  const rows: any[] = await HistoricalSuspense.find({ trackingVehicle: tvId, driver: ctx._raw.driver, ...(role === "RSA" ? {} : { status: "SUBMITTED" }) }).sort({ createdAt: 1, revision: 1 }).lean();
  const byEntry = new Map<string, any[]>();
  for (const r of rows) byEntry.set(String(r.entryId), [r, ...(byEntry.get(String(r.entryId)) ?? [])]);
  return [...byEntry.values()].map((revs) => {
    revs.sort((a, b) => b.revision - a.revision);
    return { entryId: String(revs[0].entryId), current: shape(revs[0]), revisions: revs.map(shape) };
  });
}

/** One initial submission per driver + vehicle + PIF: after it, nothing new can be added or submitted, only corrected. */
async function assertFirstSubmission(c: Ctx) {
  const h: any = await HistoricalSuspense.findOne({ driver: c.driver, vehicle: c.ctx._raw.vehicle, trackingVehicle: c.tvId, status: "SUBMITTED" }).sort({ revision: -1 }).setOptions({ withDeleted: true }).lean();
  if (!h) return;
  const p: any = await SettlementPayment.findOne({ previousDataEntry: h.entryId }).select("paymentNumber").lean();
  throw new AppError(`Previous Data was already submitted for this driver, vehicle and PIF ${h.pifNumber}: ${describeHistorical(h)}${p ? `, payment ${p.paymentNumber}` : ""}, by ${h.submittedBy}. Only a correction of that entry is allowed`, 409);
}

/** Adding or correcting is allowed only while no Final Settlement stands (none, or all rejected). */
async function assertNoFinal(tvId: string, driver: string) {
  const final: any = await SettlementPayment.findOne({ category: "FINAL", trackingVehicle: tvId, driver, status: { $ne: "REJECTED" } }).select("paymentNumber status").lean();
  if (final) throw new AppError(`Final settlement ${final.paymentNumber} (${String(final.status).toLowerCase()}) exists for this driver on this vehicle; previous data can no longer be added or corrected`, 409);
}

/**
 * The same money must not be counted twice. Same driver and vehicle only: the same Reference No. / UTR, or the same amount for
 * the same From and To dates. Overlapping dates alone are not a duplicate.
 */
async function assertNotDuplicate(tvId: string, driver: string, v: { referenceNumber: string; amount: number; fromDate: string; toDate: string }, entryId?: unknown) {
  const ref = v.referenceNumber.toUpperCase();
  const same = (amount: unknown, from: string, to: string) => paise(amount) === paise(v.amount) && from === v.fromDate && to === v.toDate;
  const daily: any[] = await SettlementPayment.find({ trackingVehicle: tvId, driver, category: "DAILY", status: { $ne: "REJECTED" }, previousDataEntry: null }).select("paymentNumber status fromDate toDate amount completion.referenceNumber").lean();
  for (const p of daily) {
    const byRef = String(p.completion?.referenceNumber ?? "").toUpperCase() === ref;
    if (byRef || same(p.amount, p.fromDate, p.toDate))
      throw new AppError(`Possible duplicate of daily payment ${p.paymentNumber} (${p.fromDate} to ${p.toDate}, ₹${p.amount}, Ref ${p.completion?.referenceNumber ?? "not recorded"}, ${String(p.status).toLowerCase()}): ${byRef ? "same Reference No. / UTR" : "same amount and dates"}`, 409);
  }
  for (const h of await countedHistorical(tvId, driver)) {
    if (entryId && String(h.entryId) === String(entryId)) continue;
    const byRef = String(h.referenceNumber).toUpperCase() === ref;
    if (byRef || same(h.amount, h.fromDate, h.toDate)) throw new AppError(`Possible duplicate of ${describeHistorical(h)}: ${byRef ? "same Reference No. / UTR" : "same amount and dates"}`, 409);
  }
}

interface Ctx { tvId: string; driver: string; ctx: Awaited<ReturnType<typeof projectContext>> }
async function open(tvId: string, role: string): Promise<Ctx> {
  if (role !== "RSA") throw new AppError("Only RSA can add or change previous suspense data", 403);
  const ctx = await projectContext(tvId);
  return { tvId, driver: String(ctx._raw.driver), ctx };
}

/**
 * Makes the completed daily payment match a submitted revision. A completed reference belongs to one daily payment only, the
 * same rule as recording a payment. `save` stores the revision once that is known to be possible.
 */
async function complete(entryId: unknown, referenceNumber: string, username: string, save: () => Promise<{ row: any; replay?: boolean }>, undo: (row: any) => Promise<unknown>) {
  return withLock(refLock("DAILY", referenceNumber), async () => {
    const mine: any = entryId ? await SettlementPayment.findOne({ previousDataEntry: entryId }).select("_id").lean() : null;
    await assertReferenceFree("DAILY", referenceNumber, mine?._id);
    const saved = await save();
    try {
      await recordPreviousData(saved.row, username);
    } catch (e) {
      // a failed submission must not stay "submitted" (it would lock the combination). Not undone if the payment was written.
      if (!saved.replay && !(await SettlementPayment.exists({ previousDataEntry: saved.row.entryId, version: saved.row.revision }))) await undo(saved.row);
      throw e;
    }
    return saved;
  });
}

// the raw collection: the model refuses to touch submitted rows, and this only takes back one that never took effect
const discard = (row: any) => HistoricalSuspense.collection.deleteOne({ _id: row._id });

/** One writer at a time, with the same locks as Final submission and Daily submission of this driver. */
const locked = <T>(c: Ctx, fn: () => Promise<T>) => withLock(`FINAL:${c.driver}`, () => withLock(`DAILY:${c.tvId}:${c.driver}`, fn));

async function result(c: Ctx, row: any, replay = false) {
  const { rows, total } = await suspenseFor(c.tvId, c.driver, null);
  return { record: shape(row), replay, suspense: { rows, total } };
}

const identity = ({ ctx, tvId, driver }: Ctx) => ({
  project: ctx._raw.project, trackingVehicle: tvId, allotment: ctx._raw.allotment, vehicle: ctx._raw.vehicle, driver,
  trackupNumber: ctx.trackupNumber, pifNumber: ctx.pifNumber, vehicleNo: ctx.vehicle.vehicleNo, driverNumber: ctx.driver.driverNumber, driverName: ctx.driver.driverName,
});

async function insert(c: Ctx, key: string, doc: Record<string, unknown>) {
  const replayOf = async () => {
    const same: any = await HistoricalSuspense.findOne({ idempotencyKey: key }).lean();
    if (same && (String(same.trackingVehicle) !== c.tvId || String(same.driver) !== c.driver)) throw new AppError("This submission key was already used", 409);
    return same;
  };
  const again = await replayOf();
  if (again) return { row: again, replay: true };
  try {
    return { row: (await HistoricalSuspense.create({ ...identity(c), ...doc, idempotencyKey: key }) as any).toObject(), replay: false };
  } catch (e) {
    if (!isDup(e)) throw e;
    const won = await replayOf();
    if (won) return { row: won, replay: true };
    await assertFirstSubmission(c); // lost a race for the one initial submission
    throw new AppError("This entry was just changed by someone else; reload", 409);
  }
}

/** A new entry: saved as a draft, or submitted at once. */
export async function createHistorical(tvId: string, input: unknown, username: string, role: string) {
  const c = await open(tvId, role);
  const v = validate(input);
  const submit = (input as { submit?: unknown }).submit === true;
  const saved = await locked(c, async () => {
    const same: any = await HistoricalSuspense.findOne({ idempotencyKey: v.key, trackingVehicle: tvId, driver: c.driver }).lean();
    if (same) {
      if (same.status === "SUBMITTED") await recordPreviousData(same, username); // finishes a submission that was interrupted
      return { row: same, replay: true };
    }
    await assertFirstSubmission(c);
    await assertNoFinal(tvId, c.driver);
    await assertNotDuplicate(tvId, c.driver, v.values);
    const store = () => insert(c, v.key, {
      ...v.values, entryId: new mongoose.Types.ObjectId(), revision: 1, status: submit ? "SUBMITTED" : "DRAFT", createdBy: username, createdByRole: role,
      ...(submit ? { submittedBy: username, submittedAt: new Date() } : {}),
    });
    return submit ? complete(null, v.values.referenceNumber, username, store, discard) : store();
  });
  return result(c, saved.row, saved.replay);
}

async function latest(c: Ctx, entryId: string) {
  if (!/^[a-f0-9]{24}$/i.test(entryId)) throw new AppError("Invalid entry id", 400);
  const row: any = await HistoricalSuspense.findOne({ entryId, trackingVehicle: c.tvId, driver: c.driver }).sort({ revision: -1 }).lean();
  if (!row) throw new AppError("Previous data entry not found", 404);
  return row;
}
const draftOnly = (row: any) => {
  if (row.status !== "DRAFT") throw new AppError("A submitted entry cannot be edited or deleted; record a correction instead", 409);
};

export async function updateDraft(tvId: string, entryId: string, input: unknown, username: string, role: string) {
  const c = await open(tvId, role);
  const v = validate(input);
  const row = await locked(c, async () => {
    const cur = await latest(c, entryId);
    draftOnly(cur);
    await assertNoFinal(tvId, c.driver);
    await assertNotDuplicate(tvId, c.driver, v.values, cur.entryId);
    const { bankName, remarks, ...rest } = v.values;
    return HistoricalSuspense.findOneAndUpdate(
      { _id: cur._id, status: "DRAFT" },
      { $set: { ...rest, bankName: bankName ?? "", remarks: remarks ?? "", updatedBy: username } }, { returnDocument: "after" },
    ).lean();
  });
  if (!row) throw new AppError("This entry was just changed by someone else; reload", 409);
  return result(c, row);
}

export async function submitDraft(tvId: string, entryId: string, username: string, role: string) {
  const c = await open(tvId, role);
  const row = await locked(c, async () => {
    const cur = await latest(c, entryId);
    if (cur.status === "SUBMITTED" && cur.revision === 1) { // already done (a retry)
      await recordPreviousData(cur, username);
      return cur;
    }
    draftOnly(cur);
    await assertFirstSubmission(c);
    await assertNoFinal(tvId, c.driver);
    await assertNotDuplicate(tvId, c.driver, cur, cur.entryId);
    const done = await complete(cur.entryId, cur.referenceNumber, username, async () => {
      const row = await HistoricalSuspense.findOneAndUpdate({ _id: cur._id, status: "DRAFT" }, { $set: { status: "SUBMITTED", submittedBy: username, submittedAt: new Date() } }, { returnDocument: "after" }).lean();
      if (!row) throw new AppError("This entry was just changed by someone else; reload", 409);
      return { row };
    }, (row) => HistoricalSuspense.collection.updateOne({ _id: row._id }, { $set: { status: "DRAFT" }, $unset: { submittedBy: 1, submittedAt: 1 } }));
    return done.row;
  });
  if (!row) throw new AppError("This entry was just changed by someone else; reload", 409);
  return result(c, row);
}

export async function deleteDraft(tvId: string, entryId: string, role: string) {
  const c = await open(tvId, role);
  await locked(c, async () => {
    const cur = await latest(c, entryId);
    draftOnly(cur);
    await HistoricalSuspense.deleteOne({ _id: cur._id, status: "DRAFT" });
  });
  return { deleted: true };
}

/** A submitted entry is wrong: the corrected values become the next revision; the earlier ones are kept as they were. */
export async function correctEntry(tvId: string, entryId: string, input: unknown, username: string, role: string) {
  const c = await open(tvId, role);
  const v = validate(input);
  const b = input as { reason?: unknown; revision?: unknown };
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason || reason.length > 500 || !SAFE_TEXT.test(reason)) throw new AppError("Enter the reason for the correction (max 500 characters)", 400);
  const saved = await locked(c, async () => {
    const same: any = await HistoricalSuspense.findOne({ idempotencyKey: v.key, trackingVehicle: tvId, driver: c.driver }).lean();
    if (same) {
      await recordPreviousData(same, username);
      return { row: same, replay: true };
    }
    const cur = await latest(c, entryId);
    if (cur.status !== "SUBMITTED") throw new AppError("A draft is edited directly; a correction applies to a submitted entry", 409);
    if (b.revision !== cur.revision) throw new AppError("This entry has a newer revision; reload before correcting it", 409);
    await assertNoFinal(tvId, c.driver);
    await assertNotDuplicate(tvId, c.driver, v.values, cur.entryId);
    return complete(cur.entryId, v.values.referenceNumber, username, () => insert(c, v.key, {
      ...v.values, entryId: cur.entryId, revision: cur.revision + 1, status: "SUBMITTED", correctionReason: reason,
      createdBy: username, createdByRole: role, submittedBy: username, submittedAt: new Date(),
    }), discard);
  });
  return result(c, saved.row, saved.replay);
}
