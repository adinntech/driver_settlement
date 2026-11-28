import mongoose, { Schema } from "mongoose";
import { hideDeleted } from "./DeletedProject.js";

const vehicleSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true, index: true },
    vehicleIndex: { type: Number, required: true },
    trackupNumber: { type: String, required: true, index: true }, // shared by the vehicles of one type in a project
    pifNumber: { type: String, required: true, unique: true },
    // requested vehicle type (absent on requests created before vehicle types existed)
    vehicleTypeCode: String,
    vehicleType: String,
    budgetStatus: { type: String, enum: ["PENDING", "CREATED"], default: "PENDING" },
  },
  { timestamps: true },
);

hideDeleted(vehicleSchema, "project");
export const TrackingVehicle =
  mongoose.models.TrackingVehicle ?? mongoose.model("TrackingVehicle", vehicleSchema);
