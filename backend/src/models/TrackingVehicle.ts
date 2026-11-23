import mongoose, { Schema } from "mongoose";

const vehicleSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true, index: true },
    vehicleIndex: { type: Number, required: true },
    trackupNumber: { type: String, required: true, unique: true },
    pifNumber: { type: String, required: true, unique: true },
    displayNumber: { type: String, required: true, unique: true },
    budgetStatus: { type: String, enum: ["PENDING", "CREATED"], default: "PENDING" },
  },
  { timestamps: true },
);

export const TrackingVehicle =
  mongoose.models.TrackingVehicle ?? mongoose.model("TrackingVehicle", vehicleSchema);
