import mongoose, { Schema } from "mongoose";

/**
 * One line of an IOCL "Financial Transaction Statement". Kept apart from every payment / settlement collection.
 * Txn ID is unique, so uploading a statement again (or an overlapping one) never duplicates or overwrites a stored row.
 * Project and driver are NOT stored: they are matched from the application records when listed or exported, so a correction
 * there shows up here.
 */
const schema = new Schema(
  {
    txnId: { type: String, required: true, unique: true },
    txnDate: { type: String, required: true }, // YYYY-MM-DD (IST)
    txnTime: String, // HH:mm:ss
    txnType: { type: String, required: true },
    vehicleNo: String, // normalised (TN58BH5459); absent when the line has none
    vehicleNoRaw: String,
    product: String,
    rsp: Number,
    quantity: Number,
    amount: { type: Number, default: null }, // verified rupees; null when the file does not give a trustworthy figure
    fileAmount: { type: Number, default: null }, // the Amount cell exactly as uploaded
    amountCorrected: { type: Boolean, default: false },
    odometer: String,
    location: String, // fuel station
    state: String,
    merchantName: String,
    fileName: String,
    uploadedBy: { type: String, required: true },
  },
  { timestamps: true },
);
schema.index({ txnDate: 1, vehicleNo: 1 });

export const IoclTransaction = mongoose.models.IoclTransaction ?? mongoose.model("IoclTransaction", schema);
