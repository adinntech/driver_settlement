import mongoose, { Schema } from "mongoose";

const projectSchema = new Schema(
  {
    projectType: { type: String, enum: ["ROADSHOW", "SIGNAGE"], required: true, index: true },
    clientName: { type: String, required: true, trim: true, index: true },
    vehicleCount: { type: Number, required: true, min: 1 },
    // Original RSOP entry; never modified by RBP.
    details: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, required: true },
    requestId: { type: String, unique: true, sparse: true }, // idempotency key
  },
  { timestamps: true },
);

export const TrackingProject =
  mongoose.models.TrackingProject ?? mongoose.model("TrackingProject", projectSchema);
