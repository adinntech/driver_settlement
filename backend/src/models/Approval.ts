import mongoose, { Schema } from "mongoose";

export const EVENT_ACTIONS = ["CREATED", "UPDATED", "SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED"] as const;
export type EventAction = (typeof EVENT_ACTIONS)[number];

// Immutable, append-only approval history (one row per action on a budget version).
const eventSchema = new Schema(
  {
    budget: { type: Schema.Types.ObjectId, ref: "Budget", required: true, index: true },
    version: { type: Number, required: true },
    action: { type: String, enum: EVENT_ACTIONS, required: true },
    username: { type: String, required: true },
    role: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// A given action can happen only once per version, so retries can never double-record it.
eventSchema.index({ budget: 1, version: 1, action: 1 }, { unique: true });
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete"] as const)
  eventSchema.pre(op, function () {
    throw new Error("Approval history is immutable");
  });

export const NOTIFICATION_TYPES = [
  "BUDGET_SUBMITTED",
  "BUDGET_RESUBMITTED",
  "BUDGET_APPROVED",
  "BUDGET_REJECTED",
  "CLEARANCE_SUBMITTED",
  "CLEARANCE_RESUBMITTED",
  "CLEARANCE_APPROVED",
  "CLEARANCE_REJECTED",
  "VEHICLE_DELIVERED",
  "PAYMENT_SUBMITTED",
  "PAYMENT_APPROVED",
  "PAYMENT_REJECTED",
  "PAYMENT_COMPLETED",
  "PROJECT_DELETED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: null },
    read: { type: Boolean, default: false },
    readAt: Date,
    dedupeKey: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, dedupeKey: 1 }, { unique: true }); // no duplicate notifications

export const BudgetEvent = mongoose.models.BudgetEvent ?? mongoose.model("BudgetEvent", eventSchema);
export const Notification = mongoose.models.Notification ?? mongoose.model("Notification", notificationSchema);
