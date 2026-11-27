import mongoose, { Schema } from "mongoose";
/**
 * The Trackup Number shared by every vehicle of one type within one project (project type + Project Code).
 * The _id makes the claim atomic (two simultaneous requests get the same number); the unique index keeps numbers distinct.
 */
const groupSchema = new Schema({
    _id: { type: String, required: true }, // "<projectType>:<projectCode>:<vehicleTypeCode>"
    trackupNumber: { type: String, required: true, unique: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
export const TrackupGroup = mongoose.models.TrackupGroup ?? mongoose.model("TrackupGroup", groupSchema);
