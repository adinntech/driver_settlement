/* eslint-disable @typescript-eslint/no-explicit-any */
import { Clearance } from "../models/Clearance.js";
import { SettlementPayment } from "../models/SettlementPayment.js";
import { TrackingProject } from "../models/TrackingProject.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";

/**
 * On Road Vehicles (RBP + RSA): project vehicles whose vehicle and driver were RSA-approved AND delivered, and whose delivered
 * allotment is still the active one (released / replaced vehicles are no longer on road). Read-only: daily payments are entered
 * through the existing settlement endpoints, with their existing permissions and rules.
 */
export interface OnRoadQuery { q?: string; projectType?: string; page?: number; limit?: number }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listOnRoadVehicles(q: OnRoadQuery) {
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const and: any[] = [];
  if (q.q?.trim()) {
    const rx = new RegExp(esc(q.q.trim()), "i");
    and.push({ $or: [{ trackupNumber: rx }, { pifNumber: rx }, { clientName: rx }, { vehicleNo: rx }, { driverName: rx }, { driverNumber: rx }, { projectName: rx }] });
  }
  if (q.projectType && ["ROADSHOW", "SIGNAGE"].includes(q.projectType)) and.push({ projectType: q.projectType });
  const pipeline: any[] = [
    { $match: { status: "APPROVED", deliveryStatus: "DELIVERED", ...(and.length ? { $and: and } : {}) } },
    { $lookup: { from: VehicleAllotment.collection.name, localField: "allotment", foreignField: "_id", as: "a" } },
    { $unwind: "$a" },
    { $match: { "a.status": "ACTIVE" } }, // still on road: the delivered allotment has not been released or replaced
    { $lookup: { from: TrackingProject.collection.name, localField: "project", foreignField: "_id", as: "proj" } },
    { $unwind: { path: "$proj", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: SettlementPayment.collection.name, let: { tv: "$trackingVehicle" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$trackingVehicle", "$$tv"] }, { $eq: ["$category", "DAILY"] }] } } },
          { $group: { _id: null, count: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } }, rejected: { $sum: { $cond: [{ $eq: ["$status", "REJECTED"] }, 1, 0] } }, lastTo: { $max: "$toDate" } } },
        ],
        as: "pay",
      },
    },
    { $sort: { deliveredAt: -1, _id: -1 } },
    { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: "n" }] } },
  ];
  const [r]: any[] = await Clearance.aggregate(pipeline);
  const road = (x: any) => x.proj?.projectType === "ROADSHOW";
  const items = (r?.items ?? []).map((x: any) => {
    const pay = x.pay?.[0];
    return {
      clearanceId: String(x._id), trackingVehicle: String(x.trackingVehicle), allotment: String(x.allotment),
      trackupNumber: x.trackupNumber, pifNumber: x.pifNumber, projectType: x.proj?.projectType ?? x.projectType ?? null,
      clientName: x.clientName ?? x.proj?.clientName ?? null, projectName: x.projectName ?? null, vehicleNo: x.vehicleNo ?? null, requestedVehicleType: x.a?.requestedVehicleType ?? null,
      driverNumber: x.driverNumber ?? null, driverName: x.driverName ?? null,
      campaignFromDate: (road(x) ? x.proj?.details?.startDate : x.proj?.details?.fromDate) ?? null,
      campaignToDate: (road(x) ? x.proj?.details?.endDate : x.proj?.details?.toDate) ?? null,
      deliveredAt: x.deliveredAt ?? null, deliveredBy: x.deliveredBy ?? null,
      dailyPayments: { count: pay?.count ?? 0, pending: pay?.pending ?? 0, rejected: pay?.rejected ?? 0, lastPaidUpTo: pay?.lastTo ?? null },
    };
  });
  return { items, total: r?.total?.[0]?.n ?? 0, page, limit };
}
