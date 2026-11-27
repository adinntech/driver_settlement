import mongoose, { Schema } from "mongoose";
/**
 * One row per submitted advance. Rows are immutable transactions: a new advance always creates a new row, and the salary used is
 * snapshotted here so later salary changes never alter a past calculation. The driver's own salary / bank details are never touched.
 */
const advanceSchema = new Schema({
    driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    driverNumber: { type: String, required: true },
    driverName: { type: String, required: true },
    workingDays: { type: Number, required: true },
    perDaySalary: { type: Number, required: true }, // salary snapshot at submission
    eligibleAdvanceAmount: { type: Number, required: true }, // workingDays x perDaySalary
    calculatedHalfAmount: { type: Number, required: true }, // eligible / 2, before rounding
    finalAdvanceAmount: { type: Number, required: true },
    roundingUnit: { type: Number, required: true },
    roundingMethod: { type: String, required: true },
    submittedBy: { type: String, required: true },
    submittedAt: { type: Date, required: true },
    idempotencyKey: { type: String, required: true }, // one submission per key: double-clicks and retries cannot create a second advance
}, { timestamps: { createdAt: true, updatedAt: false } });
advanceSchema.index({ driver: 1, submittedAt: -1 });
advanceSchema.index({ driver: 1, idempotencyKey: 1 }, { unique: true });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne", "findOneAndReplace"])
    advanceSchema.pre(op, function () {
        throw new Error("Advance records are immutable");
    });
export const DriverAdvance = mongoose.models.DriverAdvance ?? mongoose.model("DriverAdvance", advanceSchema);
