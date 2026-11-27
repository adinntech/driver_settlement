import mongoose, { Schema } from "mongoose";
export const ALLOTMENT_STATUSES = ["ACTIVE", "RELEASED", "CHANGED"];
export const ALLOTMENT_SOURCES = ["ALLOTMENT", "VEHICLE_FORM"]; // created from the Allotment tab / synced from the vehicle form
export const ALLOTMENT_ACTIONS = ["ALLOTTED", "VEHICLE_CHANGED", "RELEASED", "EXTENDED", "DRIVER_ASSIGNED", "DRIVER_CHANGED", "DRIVER_RELEASED", "DRIVER_BANK_UPDATED"];
/**
 * One row per vehicle <-> project-vehicle assignment. A replacement creates a NEW row (linked through previousAllotment)
 * and marks the old one CHANGED, so earlier allotments are never overwritten.
 * Project / vehicle master data is referenced by id; the identifiers and names are snapshotted so history stays readable.
 */
const allotmentSchema = new Schema({
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    vehicleNo: String,
    vehicleMake: String,
    vehicleModel: String,
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true },
    trackingVehicle: { type: Schema.Types.ObjectId, ref: "TrackingVehicle", required: true },
    budget: { type: Schema.Types.ObjectId, ref: "Budget" },
    budgetVersion: Number,
    trackupNumber: { type: String, required: true },
    pifNumber: { type: String, required: true },
    requestedVehicleType: String, // vehicle type RSOP asked for (snapshot)
    billNumber: String, // taken from the tracking record when it has one
    clientName: String,
    projectType: String,
    projectName: String,
    projectStart: String, // YYYY-MM-DD (project dates are plain dates)
    projectEnd: String,
    allottedAt: { type: Date, required: true }, // instants are stored in UTC and shown in IST
    expectedReleaseAt: Date,
    nextAvailableAt: { type: Date, default: null }, // optional: null = no automatic release
    remarks: String,
    status: { type: String, enum: ALLOTMENT_STATUSES, required: true, default: "ACTIVE" },
    releasedAt: Date,
    releaseReason: String,
    source: { type: String, enum: ALLOTMENT_SOURCES, default: "ALLOTMENT" },
    // vehicle replacement
    previousAllotment: { type: Schema.Types.ObjectId, ref: "VehicleAllotment" },
    changedFromVehicleNo: String,
    changeReason: String,
    changeRemarks: String,
    changeAttachments: { type: [Schema.Types.Mixed], default: [] },
    changedAt: Date, // when this allotment replaced the previous vehicle
    replacedBy: { type: Schema.Types.ObjectId, ref: "VehicleAllotment" }, // set on the old row when it becomes CHANGED
    // optional driver (absent on vehicle-only allotments and on every allotment created before driver assignment existed).
    // Earlier drivers of this allotment are kept in the immutable allotment events (DRIVER_ASSIGNED / DRIVER_CHANGED / DRIVER_RELEASED).
    driver: { type: Schema.Types.ObjectId, ref: "Driver" }, // the current (or last) driver
    activeDriver: { type: Schema.Types.ObjectId, ref: "Driver" }, // set only while the driver holds this allotment; unique guard against double assignment
    driverNumber: String,
    driverName: String,
    driverType: String,
    driverMobile: String,
    driverAssignedAt: Date,
    driverAssignedBy: String,
    driverReleasedAt: Date,
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
}, { timestamps: true });
// A project vehicle has at most one active allotment, and a vehicle serves at most one active allotment (race-safe).
allotmentSchema.index({ trackingVehicle: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });
allotmentSchema.index({ vehicle: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });
// A driver serves at most one active allotment (race-safe; only allotments that currently hold a driver carry activeDriver).
allotmentSchema.index({ activeDriver: 1 }, { unique: true, partialFilterExpression: { activeDriver: { $type: "objectId" } } });
allotmentSchema.index({ createdAt: -1 });
allotmentSchema.index({ status: 1, createdAt: -1 });
allotmentSchema.index({ trackupNumber: 1 });
allotmentSchema.index({ pifNumber: 1 });
allotmentSchema.index({ clientName: 1 });
allotmentSchema.index({ vehicleNo: 1 });
// Append-only activity trail for allotments (allotted, vehicle changed, released, extended).
const eventSchema = new Schema({
    allotment: { type: Schema.Types.ObjectId, ref: "VehicleAllotment", required: true, index: true },
    action: { type: String, enum: ALLOTMENT_ACTIONS, required: true },
    username: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });
eventSchema.index({ allotment: 1, createdAt: -1 });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete"])
    eventSchema.pre(op, function () {
        throw new Error("Allotment history is immutable");
    });
export const VehicleAllotment = mongoose.models.VehicleAllotment ?? mongoose.model("VehicleAllotment", allotmentSchema);
export const AllotmentEvent = mongoose.models.AllotmentEvent ?? mongoose.model("AllotmentEvent", eventSchema);
