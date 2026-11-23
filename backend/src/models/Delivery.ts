import mongoose, { Schema } from "mongoose";

export const DELIVERY_STATUSES = ["YET_TO_DELIVER", "DELIVERED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_ACTIONS = ["RSA_APPROVED", "SPEEDOMETER_PHOTO_UPLOADED", "EVIDENCE_PHOTO_UPLOADED", "DELIVERED"] as const;
export const PHOTO_KINDS = ["SPEEDOMETER", "EVIDENCE"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

const photo = new Schema({ storage: String, key: String, name: String, size: Number, mimeType: String }, { _id: false }); // file metadata only, never image data

/**
 * One completed delivery per approved clearance version. The unique (clearance, version) index is the duplicate-delivery lock.
 * Project / vehicle / driver references and values are snapshotted from the approved allocation.
 */
const deliverySchema = new Schema(
  {
    clearance: { type: Schema.Types.ObjectId, ref: "Clearance", required: true },
    approvalVersion: { type: Number, required: true }, // the RSA-approved submission version this delivery belongs to
    allotment: { type: Schema.Types.ObjectId, ref: "VehicleAllotment", required: true },
    trackingVehicle: { type: Schema.Types.ObjectId, ref: "TrackingVehicle", required: true },
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    trackupNumber: { type: String, required: true },
    vehicleNo: String,
    driverNumber: String,
    driverName: String,
    approvedBy: String,
    approvedAt: Date,
    description: { type: String, required: true },
    speedometerPhoto: { type: photo, required: true },
    evidencePhoto: { type: photo, required: true },
    deliveredBy: { type: String, required: true },
    deliveredAt: { type: Date, required: true }, // server time
  },
  { timestamps: true },
);
deliverySchema.index({ clearance: 1, approvalVersion: 1 }, { unique: true });
deliverySchema.index({ deliveredAt: -1 });
deliverySchema.index({ trackupNumber: 1 });

// Append-only delivery history; photo upload rows also bind a stored file to the clearance version it was uploaded for.
const eventSchema = new Schema(
  {
    clearance: { type: Schema.Types.ObjectId, ref: "Clearance", required: true },
    version: { type: Number, required: true },
    action: { type: String, enum: DELIVERY_ACTIONS, required: true },
    username: { type: String, required: true },
    role: { type: String, required: true },
    at: { type: Date, required: true },
    details: { type: Schema.Types.Mixed, default: null },
    fileKey: String, // set on photo uploads; unique so one stored file can be bound only once
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ clearance: 1, at: -1 });
eventSchema.index({ fileKey: 1 }, { unique: true, partialFilterExpression: { fileKey: { $type: "string" } } });
eventSchema.index({ clearance: 1, version: 1, action: 1 }, { unique: true, partialFilterExpression: { action: { $in: ["RSA_APPROVED", "DELIVERED"] } } });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne", "findOneAndReplace"] as const)
  eventSchema.pre(op, function () {
    throw new Error("Delivery history is immutable");
  });

export const VehicleDelivery = mongoose.models.VehicleDelivery ?? mongoose.model("VehicleDelivery", deliverySchema);
export const DeliveryEvent = mongoose.models.DeliveryEvent ?? mongoose.model("DeliveryEvent", eventSchema);
