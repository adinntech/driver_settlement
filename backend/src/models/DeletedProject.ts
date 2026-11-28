import mongoose, { Schema } from "mongoose";
import { roadshowOn } from "../utils/features.js";

/**
 * One row per project deletion by RSOP (append-only). Deleting is archiving: no project, budget, allotment or payment record is
 * changed or removed; the models using hideDeleted() leave out everything belonging to these project ids. One insert = atomic.
 */
const deletedSchema = new Schema(
  {
    projectIds: { type: [Schema.Types.ObjectId], required: true },
    projectType: { type: String, required: true },
    projectCode: String,
    clientName: { type: String, required: true },
    deletedById: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedBy: { type: String, required: true },
    deletedAt: { type: Date, required: true },
    counts: { type: Schema.Types.Mixed, default: null }, // linked records at the time of deletion
  },
  { versionKey: false },
);
deletedSchema.index({ projectIds: 1 }, { unique: true }); // a request can be deleted only once
for (const op of ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "findOneAndDelete"] as const)
  deletedSchema.pre(op, function () {
    throw new Error("Deletion history is immutable");
  });

export const DeletedProject = mongoose.models.DeletedProject ?? mongoose.model("DeletedProject", deletedSchema);

/** Project ids left out of every read: deleted ones and, while ROADSHOW is off, all Roadshow ones. */
async function hiddenProjectIds(): Promise<unknown[]> {
  const deleted: unknown[] = await DeletedProject.distinct("projectIds");
  if (roadshowOn()) return deleted;
  // the raw collection: the model itself uses this filter
  return [...deleted, ...(await mongoose.connection.collection("trackingprojects").distinct("_id", { projectType: "ROADSHOW" }))];
}

/**
 * Hides records of deleted (and switched-off Roadshow) projects from reads and updates (`field` holds the project id). Uniqueness and money checks that
 * must still see them opt out with `.setOptions({ withDeleted: true })`.
 */
export function hideDeleted(schema: Schema, field: string) {
  const filter = async () => {
    const ids = await hiddenProjectIds();
    return ids.length ? { [field]: { $nin: ids } } : null;
  };
  schema.pre(["find", "findOne", "countDocuments", "distinct", "findOneAndUpdate", "updateOne", "updateMany"], async function (this: mongoose.Query<unknown, unknown>) {
    if ((this.getOptions() as { withDeleted?: boolean }).withDeleted) return;
    const f = await filter();
    if (f) this.and([f]);
  });
  schema.pre("aggregate", async function () {
    const f = await filter();
    if (f) this.pipeline().unshift({ $match: f });
  });
}
