import mongoose, { Schema } from "mongoose";

export const CLEARANCE_STATUSES = ["YET_TO_APPROVE", "APPROVED", "REJECTED"] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];
export const FINANCIAL_STATUSES = ["NO_ADVANCE", "NO_OUTSTANDING", "OUTSTANDING", "UNAVAILABLE"] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];
export const REJECTION_REASONS = [
  "Outstanding Driver Advance", "Driver Financial Verification Failed", "Invalid Driver Details", "Invalid Vehicle Details", "Missing Documents", "Other",
] as const;
export const CLEARANCE_ACTIONS = ["ALLOCATED", "SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED", "DRIVER_CHANGED", "VEHICLE_CHANGED", "ALLOCATION_UPDATED"] as const;
export type ClearanceAction = (typeof CLEARANCE_ACTIONS)[number];

/**
 * Current RSA clearance state of a project vehicle's vehicle + driver allocation (one row per project vehicle).
 * It is separate from vehicle / driver availability, the RSOM budget approval and RSA payment entries, and never changes any of them.
 * Every version / decision is kept in the immutable ClearanceEvent trail; project / vehicle / driver values are snapshotted so history stays readable.
 */
const clearanceSchema = new Schema(
  {
    trackingVehicle: { type: Schema.Types.ObjectId, ref: "TrackingVehicle", required: true },
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true },
    allotment: { type: Schema.Types.ObjectId, ref: "VehicleAllotment", required: true }, // the allotment this submission version covers
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    trackupNumber: { type: String, required: true },
    pifNumber: { type: String, required: true },
    billNumber: String,
    displayNumber: String,
    clientName: String,
    projectType: String,
    projectName: String,
    vehicleNo: String,
    driverNumber: String,
    driverName: String,
    currentVersion: { type: Number, required: true, default: 1 },
    status: { type: String, enum: CLEARANCE_STATUSES, required: true, default: "YET_TO_APPROVE" },
    submittedBy: { type: String, required: true },
    submittedAt: { type: Date, required: true },
    reviewedBy: String,
    reviewedAt: Date,
    outstandingAdvance: { type: Number, default: null }, // snapshot taken at submission / review; null = could not be verified
    financialStatus: { type: String, enum: FINANCIAL_STATUSES },
    rejectionReason: String,
    rejectionRemarks: String,
    // Vehicle delivery (separate from the RSA status above). Absent = YET_TO_DELIVER, so rows created before this feature stay valid.
    deliveryStatus: { type: String, enum: ["YET_TO_DELIVER", "DELIVERED"] },
    deliveredAt: Date,
    deliveredBy: String,
    delivery: { type: Schema.Types.ObjectId, ref: "VehicleDelivery" },
  },
  { timestamps: true },
);
clearanceSchema.index({ trackingVehicle: 1 }, { unique: true });
clearanceSchema.index({ status: 1, submittedAt: -1 });
clearanceSchema.index({ submittedAt: -1 });
clearanceSchema.index({ trackupNumber: 1 });
clearanceSchema.index({ driver: 1 });
clearanceSchema.index({ status: 1, deliveryStatus: 1, submittedAt: -1 });

// Append-only, version-wise history.
const eventSchema = new Schema(
  {
    clearance: { type: Schema.Types.ObjectId, ref: "Clearance", required: true },
    version: { type: Number, required: true },
    action: { type: String, enum: CLEARANCE_ACTIONS, required: true },
    username: { type: String, required: true },
    role: { type: String, required: true },
    at: { type: Date, required: true },
    details: { type: Schema.Types.Mixed, default: null }, // vehicle / driver references, financial snapshot, reason, remarks
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ clearance: 1, at: -1 });
// A decision / submission can be recorded only once per version, so retries can never double-record it.
eventSchema.index(
  { clearance: 1, version: 1, action: 1 },
  { unique: true, partialFilterExpression: { action: { $in: ["ALLOCATED", "SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED"] } } },
);
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne", "findOneAndReplace"] as const)
  eventSchema.pre(op, function () {
    throw new Error("Clearance history is immutable");
  });

export const Clearance = mongoose.models.Clearance ?? mongoose.model("Clearance", clearanceSchema);
export const ClearanceEvent = mongoose.models.ClearanceEvent ?? mongoose.model("ClearanceEvent", eventSchema);
