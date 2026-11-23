import mongoose, { Schema } from "mongoose";

// Current state of a budget (one per vehicle). History lives in immutable BudgetVersion docs.
const budgetSchema = new Schema(
  {
    budgetNumber: { type: String, required: true, unique: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "TrackingVehicle", required: true, unique: true },
    project: { type: Schema.Types.ObjectId, ref: "TrackingProject", required: true, index: true },
    data: { type: Schema.Types.Mixed, required: true },
    total: { type: Number, required: true },
    currentVersion: { type: Number, required: true },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
    // Approval workflow. Budgets saved before this feature have no status and are treated as DRAFT.
    approvalStatus: { type: String, enum: ["DRAFT", "PENDING", "APPROVED", "REJECTED"] },
    submittedVersion: Number,
    submittedBy: String,
    submittedAt: Date,
    resubmissionComment: String,
    approvedVersion: Number,
    rejectedVersion: Number,
    reviewedBy: String,
    reviewedAt: Date,
    rejection: Schema.Types.Mixed, // { version, reason, fields: [{ field, comment }], rejectedBy, rejectedAt }
  },
  { timestamps: true },
);

const versionSchema = new Schema(
  {
    budget: { type: Schema.Types.ObjectId, ref: "Budget", required: true },
    version: { type: Number, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    total: { type: Number, required: true },
    changes: { type: [Schema.Types.Mixed], default: [] },
    updatedBy: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
versionSchema.index({ budget: 1, version: 1 }, { unique: true });

// Versions are immutable: block updates and deletes at the model level.
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete"] as const)
  versionSchema.pre(op, function () {
    throw new Error("Budget versions are immutable");
  });

export const Budget = mongoose.models.Budget ?? mongoose.model("Budget", budgetSchema);
export const BudgetVersion =
  mongoose.models.BudgetVersion ?? mongoose.model("BudgetVersion", versionSchema);
