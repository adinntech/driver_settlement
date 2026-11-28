import mongoose, { Schema } from "mongoose";
import { hideDeleted } from "./DeletedProject.js";

/**
 * One row per saved RSA payment entry. Entries are immutable: a new payment always creates a new row, so the history of a
 * project vehicle is never overwritten. Project / vehicle / driver values are snapshotted at save time. The entry timestamp is
 * the server's. `paymentStatus` is kept apart from the entry so a later "transferred / paid" state can be added without reshaping it.
 */
const dieselSchema = new Schema({ amount: { type: Number, required: true }, mode: String, reference: String, entryAt: { type: Date, required: true } }, { _id: false });
const expenseSchema = new Schema(
  {
    optionKey: { type: String, required: true }, optionLabel: { type: String, required: true }, // label as shown when saved
    description: String, amount: { type: Number, required: true }, deduct: { type: Boolean, default: false }, isDefault: { type: Boolean, default: false },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    paymentNumber: { type: String, required: true, unique: true }, // PAY-000123/2026-27, generated on the server from an atomic counter
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true },
    trackingVehicle: { type: Schema.Types.ObjectId, ref: "TrackingVehicle", required: true },
    allotment: { type: Schema.Types.ObjectId, ref: "VehicleAllotment", required: true },
    trackupNumber: { type: String, required: true },
    pifNumber: { type: String, required: true },
    billNumber: String,
    clientName: String,
    projectType: String,
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    vehicleNo: String,
    driver: { type: Schema.Types.ObjectId, ref: "Driver" }, // null on vehicle-only allotments
    driverNumber: String,
    driverName: String,
    paymentFor: { type: String, enum: ["ROADSHOW", "SIGNAGE"], required: true },
    campaignFromDate: String, // YYYY-MM-DD, read from the RSOP tracking details
    campaignToDate: String,
    entryDateTime: { type: Date, required: true }, // server time
    cashInHand: { type: Boolean, default: false },
    dieselEntries: { type: [dieselSchema], default: [] },
    foodAmount: { type: Number, default: 0 },
    salaryAdvance: { type: Number, default: 0 }, // recorded only: never creates a driver advance transaction
    expenses: { type: [expenseSchema], default: [] },
    dieselTotal: { type: Number, default: 0 },
    expenseTotal: { type: Number, default: 0 }, // additions
    deductTotal: { type: Number, default: 0 },
    totalPayable: { type: Number, required: true },
    paymentStatus: { type: String, enum: ["ENTERED"], default: "ENTERED" },
    idempotencyKey: { type: String, required: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);
paymentSchema.index({ trackingVehicle: 1, entryDateTime: -1 });
paymentSchema.index({ trackingVehicle: 1, idempotencyKey: 1 }, { unique: true }); // double-click / retry safe
paymentSchema.index({ trackupNumber: 1 });
paymentSchema.index({ createdBy: 1, entryDateTime: -1 });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne", "findOneAndReplace"] as const)
  paymentSchema.pre(op, function () {
    throw new Error("RSA payment entries are immutable");
  });

// Atomic counters (one document per key, e.g. "rsaPayment:2026-27").
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });

hideDeleted(paymentSchema, "project");
export const RsaPayment = mongoose.models.RsaPayment ?? mongoose.model("RsaPayment", paymentSchema);
export const Counter = mongoose.models.Counter ?? mongoose.model("Counter", counterSchema);
