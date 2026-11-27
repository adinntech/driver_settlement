import mongoose, { Schema } from "mongoose";
/**
 * Driver settlement payments raised by RBP. Two separate categories share one approval queue:
 *  - DAILY  (daily vehicle payment)            RBP submits -> RSOM approves / rejects -> RSA sees it
 *  - FINAL  (final driver salary & expenses)    RBP submits -> RSO approves / rejects
 * Approved entries are completed by RSA once accounts return the payment reference (APPROVED -> COMPLETED).
 * Entries are never deleted. Every state change and every edit is written to the immutable SettlementPaymentEvent trail,
 * with a full data snapshot per version, so the history can always be reconstructed.
 */
export const PAYMENT_CATEGORIES = ["DAILY", "FINAL"];
export const SETTLEMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"];
export const SETTLEMENT_ACTIONS = ["SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED", "EXPORTED", "COMPLETED", "MILEAGE_EDITED"];
/** Modes RSA chooses in the payment Entry popup. */
export const ENTRY_PAYMENT_MODES = ["CASH", "CHEQUE", "DD", "EPAYMENT"];
export const PAYMENT_MODE_LABEL = { CASH: "Cash", CHEQUE: "Cheque", DD: "DD", EPAYMENT: "ePayment", NEFT: "NEFT", RTGS: "RTGS", IMPS: "IMPS", UPI: "UPI" };
/** Every stored mode: the Entry modes plus the earlier accounts modes, kept so completed records stay valid. */
export const PAYMENT_MODES = [...ENTRY_PAYMENT_MODES, "NEFT", "RTGS", "IMPS", "UPI"];
const encrypted = new Schema({ iv: String, tag: String, data: String }, { _id: false }); // AES-256-GCM, never returned by the API
const completionSchema = new Schema({
    referenceNumber: { type: String, required: true },
    referenceDate: String, // YYYY-MM-DD, optional (Ref. Date)
    paymentDate: { type: String, required: true }, // YYYY-MM-DD
    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },
    bankName: String, // required by the API except for Cash
    transactionDetails: encrypted, // UTR / cheque details, encrypted at rest
    transactionMasked: String,
    remarks: String,
    completedBy: { type: String, required: true },
    completedAt: { type: Date, required: true },
}, { _id: false });
const paymentSchema = new Schema({
    paymentNumber: { type: String, required: true, unique: true }, // DVP-000001/2026-27 (daily) or DSE-000001/2026-27 (final)
    category: { type: String, enum: PAYMENT_CATEGORIES, required: true },
    status: { type: String, enum: SETTLEMENT_STATUSES, required: true },
    version: { type: Number, required: true, default: 1 },
    // relationships (validated against the approved, allotted project vehicle at submit time)
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true },
    trackingVehicle: { type: Schema.Types.ObjectId, ref: "TrackingVehicle", required: true },
    allotment: { type: Schema.Types.ObjectId, ref: "VehicleAllotment", required: true },
    budget: { type: Schema.Types.ObjectId, ref: "Budget", required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    // snapshots for lists, reports and exports
    trackupNumber: { type: String, required: true },
    pifNumber: String,
    jsNumber: String,
    clientName: String,
    projectType: { type: String, enum: ["ROADSHOW", "SIGNAGE"], required: true },
    vehicleNo: String,
    driverNumber: String,
    driverName: String,
    bank: { accountName: String, bankName: String, ifscCode: String, accountMasked: String, account: encrypted },
    fromDate: { type: String, required: true }, // YYYY-MM-DD: the payment period (daily) or campaign period (final)
    toDate: { type: String, required: true },
    amount: { type: Number, required: true }, // Total Payable (daily) / Net Amount (final), rupees
    data: { type: Schema.Types.Mixed, required: true }, // the validated form values and the server-calculated figures
    // workflow
    submittedBy: { type: String, required: true },
    submittedRole: { type: String, enum: ["RBP", "RSA"], default: "RBP" }, // Driver Payments is shared by RBP and RSA: one record, either role may enter it
    submittedAt: { type: Date, required: true },
    reviewedBy: String,
    reviewedRole: String,
    reviewedAt: Date,
    rejectionReason: String,
    completion: { type: completionSchema, default: null },
    exportedAt: Date,
    exportCount: { type: Number, default: 0 },
    idempotencyKey: { type: String, required: true },
    // set while a FINAL settlement is pending / approved / completed: the duplicate-final lock (one per allotment + driver)
    finalLock: String,
    dseNumber: Number, // FINAL only: sequential DSE No. printed on the salary statement, assigned once at approval
}, { timestamps: true });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ finalLock: 1 }, { unique: true, partialFilterExpression: { finalLock: { $type: "string" } } });
paymentSchema.index({ status: 1, category: 1, submittedAt: -1 });
paymentSchema.index({ dseNumber: 1 }, { unique: true, partialFilterExpression: { dseNumber: { $type: "number" } } });
paymentSchema.index({ trackingVehicle: 1, category: 1, fromDate: 1 });
paymentSchema.index({ driver: 1, category: 1 });
// Entries are never deleted (completed payments in particular).
for (const op of ["deleteOne", "deleteMany", "findOneAndDelete", "findOneAndReplace", "replaceOne"])
    paymentSchema.pre(op, function () {
        throw new Error("Settlement payments cannot be deleted");
    });
const eventSchema = new Schema({
    payment: { type: Schema.Types.ObjectId, ref: "SettlementPayment", required: true, index: true },
    paymentNumber: { type: String, required: true },
    category: { type: String, enum: PAYMENT_CATEGORIES, required: true },
    version: { type: Number, required: true },
    action: { type: String, enum: SETTLEMENT_ACTIONS, required: true },
    fromStatus: String,
    toStatus: String,
    username: { type: String, required: true },
    role: { type: String, required: true },
    comment: String,
    amount: Number,
    snapshot: Schema.Types.Mixed, // the full form data of this version (SUBMITTED / RESUBMITTED)
}, { timestamps: { createdAt: true, updatedAt: false } });
eventSchema.index({ payment: 1, createdAt: 1 });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne", "findOneAndReplace"])
    eventSchema.pre(op, function () {
        throw new Error("Settlement payment history is immutable");
    });
export const SettlementPayment = mongoose.models.SettlementPayment ?? mongoose.model("SettlementPayment", paymentSchema);
export const SettlementPaymentEvent = mongoose.models.SettlementPaymentEvent ?? mongoose.model("SettlementPaymentEvent", eventSchema);
