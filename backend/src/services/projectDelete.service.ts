/* eslint-disable @typescript-eslint/no-explicit-any */
import { DeletedProject } from "../models/DeletedProject.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { TrackingVehicle } from "../models/TrackingVehicle.js";
import { Budget } from "../models/Budget.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { SettlementPayment } from "../models/SettlementPayment.js";
import { RsaPayment } from "../models/RsaPayment.js";
import { Vehicle } from "../models/Vehicle.js";
import { Driver } from "../models/Driver.js";
import { User } from "../models/User.js";
import { notifyUser } from "./notification.service.js";
import { AppError } from "../utils/AppError.js";

/** Live work that would be stranded (a vehicle or driver stays busy, money stays unpaid) if the project disappeared. */
async function blockers(ids: unknown[]): Promise<string[]> {
  const inUse = { "availability.status": "IN_USE", "availability.project.trackingProject": { $in: ids } };
  const [allotments, vehicles, drivers, payments]: any[] = await Promise.all([
    VehicleAllotment.countDocuments({ project: { $in: ids }, status: "ACTIVE" }),
    Vehicle.countDocuments(inUse),
    Driver.countDocuments(inUse),
    SettlementPayment.find({ project: { $in: ids } }).select("trackingVehicle driver category status").lean(),
  ]);
  const pair = (p: any) => `${p.trackingVehicle}:${p.driver}`;
  const settled = new Set(payments.filter((p: any) => p.category === "FINAL" && p.status === "COMPLETED").map(pair));
  const open = payments.filter((p: any) => p.status === "PENDING" || p.status === "APPROVED").length;
  const unsettled = new Set(payments.map(pair).filter((k: string) => !settled.has(k))).size;
  return [
    allotments && `${allotments} active vehicle allotment(s)`,
    vehicles && `${vehicles} vehicle(s) still In Use`,
    drivers && `${drivers} driver(s) still In Use`,
    open && `${open} settlement payment(s) awaiting approval or completion`,
    unsettled && `${unsettled} driver settlement(s) without a completed Final Settlement`,
  ].filter(Boolean) as string[];
}

/** Every login gets one notification; the dedupeKey makes a repeat of the request harmless (and delivers any that failed). */
async function announce(d: any) {
  try {
    const users = await User.find().select("_id role").lean();
    for (const u of users)
      await notifyUser(u._id, {
        type: "PROJECT_DELETED",
        title: "Project deleted",
        message: `Project ${d.projectCode ?? "(no code)"} – ${d.clientName} has been deleted by RSOP.`,
        link: `/${String(u.role).toLowerCase()}`,
        meta: { projectCode: d.projectCode ?? null, clientName: d.clientName, deletedBy: d.deletedBy, deletedAt: d.deletedAt },
        dedupeKey: `PROJECT_DELETED:${d._id}`,
      });
  } catch (e) {
    console.error("Project deletion notification failed", e); // the deletion itself is already saved
  }
}

const summary = (d: any) => ({
  projectCode: d.projectCode ?? null, clientName: d.clientName, projectType: d.projectType, deletedBy: d.deletedBy, deletedAt: d.deletedAt, requests: d.projectIds.length,
});

/**
 * Deletes (archives) the dashboard project the request belongs to: every request of the same Project Code and type, or only
 * this request when it predates Project Codes.
 */
export async function deleteProject(id: string, actor: { id: string; username: string }) {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new AppError("Invalid tracking id", 400);
  const done: any = await DeletedProject.findOne({ projectIds: id }).lean();
  if (done) {
    await announce(done);
    return summary(done);
  }
  const project: any = await TrackingProject.findById(id).lean();
  if (!project) throw new AppError("Tracking request not found", 404);
  const group: any[] = project.projectCode
    ? await TrackingProject.find({ projectType: project.projectType, projectCode: project.projectCode }).select("_id").lean()
    : [project];
  const ids = group.map((p) => p._id);

  const why = await blockers(ids);
  if (why.length) throw new AppError(`This project cannot be deleted yet: ${why.join("; ")}`, 409);

  const of = { project: { $in: ids } };
  const [vehicles, budgets, allotments, settlementPayments, vehiclePayments] = await Promise.all(
    [TrackingVehicle, Budget, VehicleAllotment, SettlementPayment, RsaPayment].map((m: any) => m.countDocuments(of)),
  );
  let record: any;
  try {
    record = await DeletedProject.create({
      projectIds: ids, projectType: project.projectType, projectCode: project.projectCode, clientName: project.clientName,
      deletedById: actor.id, deletedBy: actor.username, deletedAt: new Date(),
      counts: { vehicles, budgets, allotments, settlementPayments, vehiclePayments },
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new AppError("This project has already been deleted", 409);
    throw e;
  }
  await announce(record);
  return summary(record);
}
