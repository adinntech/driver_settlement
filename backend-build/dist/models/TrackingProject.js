import mongoose, { Schema } from "mongoose";
const projectSchema = new Schema({
    projectType: { type: String, enum: ["ROADSHOW", "SIGNAGE"], required: true, index: true },
    clientName: { type: String, required: true, trim: true, index: true },
    // 8-digit Project Code: one project (per project type) can span several tracking requests, each with its own vehicles.
    // Optional in the schema so requests created before the code existed stay valid (they are shown as their own project).
    projectCode: { type: String, trim: true },
    vehicleCount: { type: Number, required: true, min: 1 },
    // Original RSOP entry; never modified by RBP.
    details: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, required: true },
    requestId: { type: String, unique: true, sparse: true }, // idempotency key
}, { timestamps: true });
projectSchema.index({ projectType: 1, projectCode: 1 });
export const TrackingProject = mongoose.models.TrackingProject ?? mongoose.model("TrackingProject", projectSchema);
