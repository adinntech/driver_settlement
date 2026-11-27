import mongoose, { Schema } from "mongoose";
export const DRIVER_TYPES = ["COMPANY_DRIVER", "ACTING_DRIVER"];
export const DRIVER_STATUSES = ["ACTIVE", "INACTIVE"];
/** Availability (separate from the record status ACTIVE / INACTIVE). Dates are YYYY-MM-DD, times HH:mm, both IST. */
export const DRIVER_AVAILABILITY_STATUSES = ["AVAILABLE", "IN_USE", "NOT_AVAILABLE"];
export const UNAVAILABLE_CATEGORIES = ["Personal Leave", "Medical Leave", "License Issue", "Vehicle/Project Related", "Other"];
const availabilitySchema = new Schema({
    status: { type: String, enum: [...DRIVER_AVAILABILITY_STATUSES, null] },
    availableFromDate: String,
    availableFromTime: String,
    project: {
        trackingProject: { type: Schema.Types.ObjectId }, // link to the RSOP project (never modified from here)
        trackingVehicle: { type: Schema.Types.ObjectId },
        budget: { type: Schema.Types.ObjectId },
        budgetVersion: Number,
        projectType: String,
        projectName: String,
        clientName: String,
        trackupNumber: String,
        pifNumber: String,
        startDate: String, // Project From Date
        endDate: String, // Project To Date: the driver is released automatically once this date has passed (IST)
        remarks: String,
        // set when the driver was assigned through a Vehicle Allotment (links the driver's allocation to that allotment)
        allotment: { type: Schema.Types.ObjectId },
        vehicle: { type: Schema.Types.ObjectId },
        vehicleNo: String,
    },
    notAvailable: {
        reason: String,
        category: String,
        fromDate: String,
        expectedAvailableDate: String, // informational only: never releases the driver by itself
        remarks: String,
    },
    revision: { type: Number, default: 1 }, // bumped on every availability change; the scheduler's conditional update relies on it
    lastStatusUpdatedBy: String,
    lastStatusUpdatedAt: Date,
    autoReleasedAt: Date,
}, { _id: false });
const driverSchema = new Schema({
    driverNumber: { type: String, required: true }, // DR-1234, generated on the server and never changed
    driverName: { type: String, required: true },
    driverType: { type: String, enum: DRIVER_TYPES, required: true },
    address: String,
    mobileNumber: { type: String, required: true }, // "+91 9876543210"
    mobileDigits: { type: String, required: true }, // 10 national digits, for search and the duplicate check
    accountName: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    licenceNumber: String, // as shown to the user (normalised upper case)
    licenceKey: String, // licence number without separators: duplicate check + search
    licenceType: String,
    licenceExpiryDate: String, // YYYY-MM-DD
    attachment: Schema.Types.Mixed, // { storage, key, name, size, mimeType } or null
    salary: { type: Number, default: 0 },
    status: { type: String, enum: DRIVER_STATUSES, default: "ACTIVE" },
    availability: { type: availabilitySchema, default: undefined }, // absent on drivers created before this feature
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
}, { timestamps: true });
driverSchema.index({ driverNumber: 1 }, { unique: true });
driverSchema.index({ mobileDigits: 1 }, { unique: true });
driverSchema.index({ licenceKey: 1 }, { unique: true, partialFilterExpression: { licenceKey: { $type: "string" } } });
driverSchema.index({ createdAt: -1 });
driverSchema.index({ driverName: 1 });
driverSchema.index({ "availability.status": 1, "availability.project.endDate": 1 });
driverSchema.index({ "availability.project.trackupNumber": 1 });
export const DRIVER_HISTORY_ACTIONS = [
    "CREATED", "UPDATED", "STATUS_CHANGED", "PROJECT_ASSIGNED", "PROJECT_EXTENDED", "PROJECT_UPDATED", "MARKED_NOT_AVAILABLE",
    "NOT_AVAILABLE_UPDATED", "AVAILABILITY_CONFIRMED", "AVAILABILITY_UPDATED", "AUTO_AVAILABILITY_UPDATE", "BANK_UPDATED",
];
// Append-only audit trail of a driver (details + availability).
const historySchema = new Schema({
    driver: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, enum: DRIVER_HISTORY_ACTIONS, required: true },
    changes: { type: [Schema.Types.Mixed], default: [] }, // [{ field, from, to }]
    username: { type: String, required: true },
    previousStatus: String,
    newStatus: String,
    project: Schema.Types.Mixed, // snapshot of the project allocation involved (the previous one when it is released)
    reason: String,
    autoKey: String, // idempotency key for scheduler events: one automatic release per driver + allocation
}, { timestamps: { createdAt: true, updatedAt: false } });
historySchema.index({ driver: 1, createdAt: -1 });
historySchema.index({ autoKey: 1 }, { unique: true, partialFilterExpression: { autoKey: { $type: "string" } } });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete"])
    historySchema.pre(op, function () {
        throw new Error("Driver history is immutable");
    });
export const Driver = mongoose.models.Driver ?? mongoose.model("Driver", driverSchema);
export const DriverHistory = mongoose.models.DriverHistory ?? mongoose.model("DriverHistory", historySchema);
