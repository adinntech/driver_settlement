/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Schema } from "mongoose";
import { hideDeleted } from "./DeletedProject.js";

/**
 * "Previous Data": a payment made before it was recorded in this application, typed in by RSA so it counts towards the
 * Suspense Amount of that driver on that project vehicle. It is not a live Daily Payment: no approval, no completion.
 * One entry (entryId) has numbered revisions. A DRAFT may be edited or deleted and counts nowhere. A SUBMITTED revision is
 * never changed or deleted: a correction adds the next revision, with its reason, and only the latest one counts.
 */
const historicalSchema = new Schema(
  {
    entryId: { type: Schema.Types.ObjectId, required: true },
    revision: { type: Number, required: true, default: 1 },
    status: { type: String, enum: ["DRAFT", "SUBMITTED"], required: true },
    source: { type: String, enum: ["MANUAL_HISTORICAL"], required: true, default: "MANUAL_HISTORICAL" },
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true },
    trackingVehicle: { type: Schema.Types.ObjectId, ref: "TrackingVehicle", required: true },
    allotment: { type: Schema.Types.ObjectId, ref: "VehicleAllotment", required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    trackupNumber: { type: String, required: true },
    pifNumber: { type: String, required: true },
    vehicleNo: String,
    driverNumber: String,
    driverName: String,
    fromDate: { type: String, required: true }, // YYYY-MM-DD (IST), as on the original record
    toDate: { type: String, required: true },
    paymentDate: { type: String, required: true },
    paymentMode: { type: String, required: true },
    bankName: String,
    referenceNumber: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true }, // the amounts, in the shape of a daily payment's data
    amount: { type: Number, required: true }, // total payable of those amounts (server calculated)
    sourceDetails: String, // optional: where the figures were taken from
    remarks: String,
    correctionReason: String, // revisions after the first
    createdBy: { type: String, required: true }, // who made this revision
    createdByRole: { type: String, required: true },
    updatedBy: String, // last draft edit
    submittedBy: String,
    submittedAt: Date,
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
historicalSchema.index({ entryId: 1, revision: 1 }, { unique: true }); // two corrections of one revision cannot both save
historicalSchema.index({ trackingVehicle: 1, driver: 1, fromDate: 1 });
// One initial submission per driver + vehicle + PIF (trackingVehicle): later changes are revisions (2+) of that entry. The
// database enforces it, so two simultaneous submissions cannot both succeed. Drafts are outside the index.
historicalSchema.index({ driver: 1, vehicle: 1, trackingVehicle: 1 }, { name: "one_initial_submission", unique: true, partialFilterExpression: { revision: 1, status: "SUBMITTED" } });
// only a draft can ever be changed or removed
for (const op of ["updateOne", "findOneAndUpdate", "deleteOne", "findOneAndDelete"] as const)
  historicalSchema.pre(op, function (this: mongoose.Query<unknown, unknown>) {
    if ((this.getFilter() as { status?: unknown }).status !== "DRAFT") throw new Error("Submitted previous data is immutable");
  });
for (const op of ["updateMany", "deleteMany"] as const)
  historicalSchema.pre(op, function () {
    throw new Error("Previous data is immutable");
  });
hideDeleted(historicalSchema, "project");

export const HistoricalSuspense = mongoose.models.HistoricalSuspense ?? mongoose.model("HistoricalSuspense", historicalSchema);

/** The entries that count: the latest submitted revision of each, for one driver on one project vehicle. */
export async function countedHistorical(trackingVehicle: unknown, driver: unknown): Promise<any[]> {
  const rows: any[] = await HistoricalSuspense.find({ trackingVehicle, driver, status: "SUBMITTED" }).sort({ revision: 1 }).lean();
  return [...new Map(rows.map((r) => [String(r.entryId), r])).values()].sort((a, b) => a.fromDate.localeCompare(b.fromDate));
}

export const describeHistorical = (h: any) => `previous data entry (${h.fromDate} to ${h.toDate}, ₹${h.amount}, Ref ${h.referenceNumber}, revision ${h.revision})`;
