import mongoose, { Schema } from "mongoose";
export const VEHICLE_TYPES = ["Dynamic", "Static", "Utility", "Ladder Vehicle", "Event"];
export const VEHICLE_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE"];
export const DOC_SECTIONS = ["fc", "insurance", "rtoPermission", "policePermission", "permit"];
const docEntry = new Schema({ nextRenewalDate: String, attachment: Schema.Types.Mixed }, // attachment: { storage, key, name, size, mimeType } or null
{ _id: false });
export const AVAILABILITY_STATUSES = ["AVAILABLE", "IN_USE", "ISSUE"];
export const ISSUE_CATEGORIES = [
    "Engine Problem", "Battery Problem", "Tyre / Stepney Problem", "Accident / Body Damage", "Electrical Problem",
    "Mechanical Problem", "Document / Permit Issue", "Other",
];
export const ISSUE_STATUSES = ["OPEN", "IN_REPAIR"]; // resolving = RBP explicitly marks the vehicle Available
export const PROJECT_TYPES = ["ROADSHOW", "SIGNAGE"];
// Availability (separate from the record status DRAFT/ACTIVE/INACTIVE). Dates are YYYY-MM-DD, times HH:mm, both IST.
const availabilitySchema = new Schema({
    status: { type: String, enum: [...AVAILABILITY_STATUSES, null] },
    availableFromDate: String,
    availableFromTime: String,
    project: {
        trackingProject: { type: Schema.Types.ObjectId }, // link to the RSOP project (never modified from here)
        trackingVehicle: { type: Schema.Types.ObjectId }, // the exact project vehicle (owns the trackup + PIF pair)
        budget: { type: Schema.Types.ObjectId }, // the approved budget the allocation was based on
        budgetVersion: Number,
        projectType: String,
        projectName: String,
        clientName: String,
        trackupNumber: String,
        pifNumber: String,
        startDate: String,
        endDate: String,
        location: String,
        remarks: String,
    },
    expectedReleaseDate: String,
    expectedReleaseTime: String,
    nextAvailableDate: String,
    nextAvailableTime: String,
    issue: {
        category: String,
        description: String,
        reportedDate: String,
        reportedTime: String,
        expectedRepairDate: String,
        expectedRepairTime: String,
        garage: String,
        repairRemarks: String,
        issueStatus: String,
    },
    nextAvailableAt: String, // derived "YYYY-MM-DDTHH:mm" (IST) so the listing can filter / sort on the server
    issueResolvedAt: Date,
    autoReleasedAt: Date, // set when the scheduler released the vehicle after its next-available moment
}, { _id: false });
const vehicleSchema = new Schema({
    vehicleNo: String, // normalised upper-case; optional only while DRAFT
    make: String,
    model: String,
    type: { type: String, enum: VEHICLE_TYPES },
    yearOfManufacture: Number,
    purchaseDate: String, // YYYY-MM-DD
    currentRunning: Number,
    totalRunning: Number,
    stepneyStatus: String,
    batteryStatus: String,
    oilTopUpOn: String,
    greasePackingOn: String,
    generalCheckUpOn: String,
    fc: { type: [docEntry], default: [] },
    insurance: { type: [docEntry], default: [] },
    rtoPermission: { type: [docEntry], default: [] },
    policePermission: { type: [docEntry], default: [] },
    permit: { type: [docEntry], default: [] },
    condition: String,
    specification: String,
    availability: { type: availabilitySchema, default: undefined }, // absent on records created before this feature
    status: { type: String, enum: VEHICLE_STATUSES, required: true, default: "DRAFT" },
    // Latest expiry among the saved entries; derived on every save so listing/filtering stays server-side.
    insuranceExpiry: String,
    fcExpiry: String,
    revision: { type: Number, default: 1 },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
}, { timestamps: true });
// Unique registration number (drafts without a number are exempt).
vehicleSchema.index({ vehicleNo: 1 }, { unique: true, partialFilterExpression: { vehicleNo: { $type: "string" } } });
vehicleSchema.index({ createdAt: -1 });
vehicleSchema.index({ status: 1, createdAt: -1 });
vehicleSchema.index({ make: 1, model: 1 });
vehicleSchema.index({ insuranceExpiry: 1 });
vehicleSchema.index({ fcExpiry: 1 });
vehicleSchema.index({ "availability.status": 1, "availability.nextAvailableAt": 1 });
vehicleSchema.index({ "availability.project.trackingProject": 1 });
vehicleSchema.index({ "availability.project.clientName": 1 });
// One project vehicle (PIF number) can be allocated to only one vehicle at a time; race-safe.
vehicleSchema.index({ "availability.project.pifNumber": 1 }, { unique: true, partialFilterExpression: { "availability.status": "IN_USE", "availability.project.pifNumber": { $type: "string" } } });
export const HISTORY_ACTIONS = [
    "CREATED", "DRAFT_SAVED", "DRAFT_CONVERTED", "UPDATED", "FC_UPDATED", "INSURANCE_UPDATED", "RTO_UPDATED",
    "POLICE_UPDATED", "PERMIT_UPDATED", "MAINTENANCE_UPDATED", "STATUS_CHANGED", "DRAFT_DELETED",
    "MARKED_AVAILABLE", "PROJECT_ASSIGNED", "PROJECT_UPDATED", "RELEASE_CHANGED", "ISSUE_REPORTED", "ISSUE_UPDATED",
    "REPAIR_DATE_CHANGED", "ISSUE_RESOLVED", "AUTO_AVAILABILITY_UPDATE",
];
// Append-only audit trail; kept even after a draft is deleted.
const historySchema = new Schema({
    vehicle: { type: Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, enum: HISTORY_ACTIONS, required: true },
    changes: { type: [Schema.Types.Mixed], default: [] }, // [{ field, from, to }]
    username: { type: String, required: true },
    // availability rows only
    previousStatus: String,
    newStatus: String,
    project: Schema.Types.Mixed, // snapshot of the project details at that moment
    issueReason: String,
    reason: String, // why (e.g. scheduler release)
    autoKey: String, // idempotency key for scheduler events: one automatic release per vehicle + due moment
}, { timestamps: { createdAt: true, updatedAt: false } });
historySchema.index({ vehicle: 1, createdAt: -1 });
historySchema.index({ autoKey: 1 }, { unique: true, partialFilterExpression: { autoKey: { $type: "string" } } });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete"])
    historySchema.pre(op, function () {
        throw new Error("Vehicle history is immutable");
    });
export const Vehicle = mongoose.models.Vehicle ?? mongoose.model("Vehicle", vehicleSchema);
export const VehicleHistory = mongoose.models.VehicleHistory ?? mongoose.model("VehicleHistory", historySchema);
