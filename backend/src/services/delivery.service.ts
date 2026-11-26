/* eslint-disable @typescript-eslint/no-explicit-any */
import { Clearance, ClearanceEvent } from "../models/Clearance.js";
import { DeliveryEvent, MAX_ADDITIONAL_PHOTOS, VehicleDelivery, type PhotoKind } from "../models/Delivery.js";
import { VehicleAllotment } from "../models/VehicleAllotment.js";
import { AppError } from "../utils/AppError.js";
import { clearanceDetail, loadOne, rsaLink, syncClearances } from "./clearance.service.js";
import { notifyRole } from "./notification.service.js";
import { KEY_PATTERN, attachmentUrl, storeUpload, type Attachment } from "./storage.service.js";

/**
 * Vehicle Delivery (RBP) after RSA approval. Delivery status lives beside - never inside - the RSA clearance status, and the RSA
 * clearance / approval records are only read. Photos go through the existing storage service (file metadata only is stored).
 * The standalone MongoDB has no multi-document transactions, so "Delivered" is committed in a safe order: the unique
 * (clearance, version) delivery row is the duplicate lock, the Clearance row is then flipped with a conditional update, and the
 * delivery row is removed again if that flip loses a race - a half-finished delivery is never left marked Delivered.
 */

const ist = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d);
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 1000;
export const PHOTO_KIND_PARAM: Record<string, PhotoKind> = { speedometer: "SPEEDOMETER", evidence: "EVIDENCE", additional: "ADDITIONAL" };
const ACTION_FOR: Record<PhotoKind, string> = { SPEEDOMETER: "SPEEDOMETER_PHOTO_UPLOADED", EVIDENCE: "EVIDENCE_PHOTO_UPLOADED", ADDITIONAL: "ADDITIONAL_PHOTO_UPLOADED" };

const withUrl = (a: any) => (a ? { storage: a.storage, key: a.key, name: a.name, size: a.size, mimeType: a.mimeType, url: attachmentUrl(a) } : null);

// ---------------------------------------------------------------- summary

/** Real counts. Approved = every RSA-approved allocation (Yet to Deliver + Delivered), so those two are never counted twice. */
export async function deliverySummary() {
  await syncClearances().catch((e) => console.error("Clearance sync failed", e));
  const g: any[] = await Clearance.aggregate([
    { $group: { _id: { s: "$status", d: { $ifNull: ["$deliveryStatus", "YET_TO_DELIVER"] } }, n: { $sum: 1 } } },
  ]);
  const n = (s: string, d?: string) => g.filter((x) => x._id.s === s && (d === undefined || x._id.d === d)).reduce((a, x) => a + x.n, 0);
  const approved = n("APPROVED"), yetToApprove = n("YET_TO_APPROVE"), rejected = n("REJECTED");
  return { total: approved + yetToApprove + rejected, approved, yetToApprove, rejected, yetToDeliver: n("APPROVED", "YET_TO_DELIVER"), delivered: n("APPROVED", "DELIVERED") };
}

// ---------------------------------------------------------------- eligibility

/** Loads an RSA-approved, current, not-yet-delivered allocation or throws the precise reason it cannot be delivered. */
async function deliverable(id: string) {
  const c0 = await loadOne(id);
  // an approved allocation whose vehicle / driver changed afterwards is moved back to Yet to Approve by this sync (fresh RSA approval)
  await syncClearances({ trackingVehicle: c0.trackingVehicle }).catch(() => 0);
  const c = await loadOne(id);
  if (c.status === "YET_TO_APPROVE") throw new AppError("RSA approval is required before delivery", 409);
  if (c.status === "REJECTED") throw new AppError("A rejected allocation cannot be delivered; correct and resubmit it for RSA approval", 409);
  if (c.deliveryStatus === "DELIVERED") throw new AppError("This vehicle has already been delivered", 409);
  const a: any = await VehicleAllotment.findOne({ trackingVehicle: c.trackingVehicle, status: "ACTIVE" }).select("_id driver vehicle activeDriver").lean();
  if (!a?.activeDriver || String(a._id) !== String(c.allotment) || String(a.driver) !== String(c.driver) || String(a.vehicle) !== String(c.vehicle))
    throw new AppError("This is no longer the current active vehicle and driver allocation", 409);
  return c;
}

// ---------------------------------------------------------------- photo upload

/**
 * Stores one delivery photo (speedometer or evidence) and binds the stored file to this clearance version, so it can only be used
 * for this vehicle's delivery. A failed delivery can be retried with the already uploaded photos; nothing is marked Delivered here.
 */
export async function uploadDeliveryPhoto(id: string, kindParam: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, username: string, now = new Date()) {
  const kind = PHOTO_KIND_PARAM[kindParam];
  if (!kind) throw new AppError("Photo type must be speedometer, evidence or additional", 400);
  const c = await deliverable(id);
  if (!file) throw new AppError("Choose a photo to upload", 400);
  if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) throw new AppError("Only JPG, PNG or WEBP photos are allowed", 400);
  const a: Attachment = await storeUpload(file); // type, magic bytes and size are validated here (10 MB max)
  await DeliveryEvent.create({
    clearance: c._id, version: c.currentVersion, action: ACTION_FOR[kind], username, role: "RBP", at: now, fileKey: a.key,
    details: { kind, trackupNumber: c.trackupNumber, vehicleId: String(c.vehicle), driverId: String(c.driver), allotmentId: String(c.allotment), attachment: a },
  });
  return { kind, ...withUrl(a) };
}

// ---------------------------------------------------------------- deliver

export function validateDeliver(input: unknown): { errors: string[]; description: string; speedoKey: string; evidenceKey: string; additionalKeys: string[]; version?: number } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const errors: string[] = [];
  const description = typeof b.description === "string" ? b.description.trim().replace(/[ \t]+/g, " ") : "";
  if (!description) errors.push("Delivery description is required");
  else if (description.length < DESCRIPTION_MIN) errors.push(`Delivery description must be at least ${DESCRIPTION_MIN} characters`);
  else if (description.length > DESCRIPTION_MAX) errors.push(`Delivery description is too long (max ${DESCRIPTION_MAX})`);
  const key = (o: any, label: string) => {
    const k = o && typeof o === "object" ? o.key : undefined;
    if (typeof k !== "string" || !k) { errors.push(`${label} is required`); return ""; }
    if (!KEY_PATTERN.test(k)) { errors.push(`${label} is invalid`); return ""; }
    return k;
  };
  const speedoKey = key(b.speedometerPhoto, "Speedometer photo");
  const evidenceKey = key(b.evidencePhoto, "Driver & vehicle handover photo");
  if (speedoKey && speedoKey === evidenceKey) errors.push("The speedometer photo and the handover photo must be two different photos");
  // Additional photos: optional, up to MAX_ADDITIONAL_PHOTOS distinct photos, none of them the speedometer or handover photo.
  const additionalKeys: string[] = [];
  if (b.additionalPhotos !== undefined && b.additionalPhotos !== null) {
    if (!Array.isArray(b.additionalPhotos)) errors.push("Additional photos must be a list");
    else if (b.additionalPhotos.length > MAX_ADDITIONAL_PHOTOS) errors.push(`Too many additional photos (max ${MAX_ADDITIONAL_PHOTOS})`);
    else
      b.additionalPhotos.forEach((p: unknown, i: number) => {
        const k = key(p, `Additional photo ${i + 1}`);
        if (!k) return;
        if (k === speedoKey || k === evidenceKey || additionalKeys.includes(k)) errors.push(`Additional photo ${i + 1} is a duplicate of another delivery photo`);
        else additionalKeys.push(k);
      });
  }
  const version = b.version === undefined || b.version === null ? undefined : Number(b.version);
  return { errors, description, speedoKey, evidenceKey, additionalKeys, version };
}

export async function deliverVehicle(id: string, input: unknown, username: string, now = new Date()) {
  const v = validateDeliver(input);
  if (v.errors.length) throw new AppError(v.errors.join("; "), 400);
  const c0 = await loadOne(id);
  // a retry of an already completed delivery with the same photos returns it instead of creating a second one
  if (c0.deliveryStatus === "DELIVERED") {
    const done: any = await VehicleDelivery.findOne({ clearance: c0._id, approvalVersion: c0.currentVersion }).lean();
    const sameExtra = JSON.stringify((done?.additionalPhotos ?? []).map((p: any) => p.key)) === JSON.stringify(v.additionalKeys);
    if (done && done.speedometerPhoto?.key === v.speedoKey && done.evidencePhoto?.key === v.evidenceKey && sameExtra) return { replay: true, delivery: deliveryView(done) };
  }
  const c = await deliverable(id);
  if (v.version !== undefined && v.version !== c.currentVersion) throw new AppError("A newer submission exists; refresh and try again", 409);

  // both photos must have been uploaded for THIS allocation version (no cross-project / cross-vehicle evidence)
  const [sp, ev]: any[] = await Promise.all([
    DeliveryEvent.findOne({ fileKey: v.speedoKey }).lean(), DeliveryEvent.findOne({ fileKey: v.evidenceKey }).lean(),
  ]);
  const ok = (e: any, kind: PhotoKind) => e && String(e.clearance) === String(c._id) && e.version === c.currentVersion && e.details?.kind === kind && String(e.details?.vehicleId) === String(c.vehicle) && String(e.details?.driverId) === String(c.driver);
  if (!ok(sp, "SPEEDOMETER")) throw new AppError("The speedometer photo does not belong to this vehicle delivery; upload it again", 400);
  if (!ok(ev, "EVIDENCE")) throw new AppError("The driver & vehicle handover photo does not belong to this vehicle delivery; upload it again", 400);
  const extra: any[] = v.additionalKeys.length ? await DeliveryEvent.find({ fileKey: { $in: v.additionalKeys } }).lean() : [];
  const additionalPhotos = v.additionalKeys.map((k, i) => {
    const e = extra.find((x) => x.fileKey === k);
    if (!ok(e, "ADDITIONAL")) throw new AppError(`Additional photo ${i + 1} does not belong to this vehicle delivery; upload it again`, 400);
    return e.details.attachment;
  });

  let doc: any;
  try {
    doc = await VehicleDelivery.create({
      clearance: c._id, approvalVersion: c.currentVersion, allotment: c.allotment, trackingVehicle: c.trackingVehicle, project: c.project, vehicle: c.vehicle, driver: c.driver,
      trackupNumber: c.trackupNumber, vehicleNo: c.vehicleNo, driverNumber: c.driverNumber, driverName: c.driverName, approvedBy: c.reviewedBy, approvedAt: c.reviewedAt,
      description: v.description, speedometerPhoto: sp.details.attachment, evidencePhoto: ev.details.attachment, additionalPhotos, deliveredBy: username, deliveredAt: now, // server time, never the browser's
    });
  } catch (e) {
    if (isDup(e)) throw new AppError("This vehicle has already been delivered", 409);
    throw e;
  }
  const upd: any = await Clearance.findOneAndUpdate(
    { _id: c._id, status: "APPROVED", currentVersion: c.currentVersion, deliveryStatus: { $ne: "DELIVERED" } },
    { $set: { deliveryStatus: "DELIVERED", deliveredAt: now, deliveredBy: username, delivery: doc._id } }, { returnDocument: "after" },
  ).lean();
  if (!upd) {
    await VehicleDelivery.deleteOne({ _id: doc._id }); // lost a race (or the allocation was just changed): leave nothing half-delivered
    throw new AppError("This allocation just changed; refresh and try again", 409);
  }
  try {
    await DeliveryEvent.create({ clearance: c._id, version: c.currentVersion, action: "DELIVERED", username, role: "RBP", at: now, details: { deliveryId: String(doc._id), trackupNumber: c.trackupNumber, vehicleId: String(c.vehicle), driverId: String(c.driver), allotmentId: String(c.allotment), description: v.description, approvedBy: c.reviewedBy, approvedAt: c.reviewedAt, speedometerPhoto: sp.details.attachment, evidencePhoto: ev.details.attachment, additionalPhotos } });
  } catch (e) {
    if (!isDup(e)) throw e;
  }
  await notifyRole("RSA", {
    type: "VEHICLE_DELIVERED", title: "Vehicle delivered",
    message: `Vehicle delivery completed successfully for ${c.trackupNumber}. ${c.clientName ?? "—"} · Vehicle ${c.vehicleNo} · Driver ${c.driverName} · Delivered by ${username} on ${ist(now)}`,
    link: rsaLink(c._id), meta: { trackupNumber: c.trackupNumber, clientName: c.clientName, vehicleNo: c.vehicleNo, driverName: c.driverName, deliveredBy: username, deliveredAt: now, version: c.currentVersion },
    dedupeKey: `VEHICLE_DELIVERED:${c._id}:${c.currentVersion}`,
  });
  return { replay: false, delivery: deliveryView(doc.toObject()) };
}

const deliveryView = (d: any) => ({
  _id: String(d._id), approvalVersion: d.approvalVersion, trackupNumber: d.trackupNumber, vehicleNo: d.vehicleNo, driverNumber: d.driverNumber, driverName: d.driverName,
  description: d.description, speedometerPhoto: withUrl(d.speedometerPhoto), evidencePhoto: withUrl(d.evidencePhoto),
  additionalPhotos: (d.additionalPhotos ?? []).map(withUrl), deliveredBy: d.deliveredBy, deliveredAt: d.deliveredAt,
  approvedBy: d.approvedBy ?? null, approvedAt: d.approvedAt ?? null,
});

// ---------------------------------------------------------------- detail (delivery form + delivered view)

/** The clearance detail plus delivery eligibility, the delivery record of the current approved version and the delivery history. */
export async function deliveryDetail(id: string) {
  const base = await clearanceDetail(id);
  const c: any = await loadOne(id);
  const [delivery, events, approvals]: any[] = await Promise.all([
    VehicleDelivery.findOne({ clearance: c._id, approvalVersion: c.currentVersion }).lean(),
    DeliveryEvent.find({ clearance: c._id }).sort({ at: -1, _id: -1 }).lean(),
    ClearanceEvent.find({ clearance: c._id, action: "APPROVED" }).lean(),
  ]);
  const deliveryHistory = [
    ...approvals.map((e: any) => ({ _id: String(e._id), version: e.version, action: "RSA_APPROVED", username: e.username, role: e.role, at: e.at, details: { vehicleNo: e.details?.vehicleNo, driverNumber: e.details?.driverNumber, driverName: e.details?.driverName } })),
    ...events.map((e: any) => ({
      _id: String(e._id), version: e.version, action: e.action, username: e.username, role: e.role, at: e.at,
      details: e.action === "DELIVERED" ? { description: e.details?.description, deliveryId: e.details?.deliveryId } : { kind: e.details?.kind, file: e.details?.attachment ? { name: e.details.attachment.name, size: e.details.attachment.size } : null },
    })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at) || (a._id < b._id ? 1 : -1));
  const deliveryStatus = c.status === "APPROVED" ? (c.deliveryStatus ?? "YET_TO_DELIVER") : null;
  return {
    ...base,
    deliveryStatus, deliveredAt: c.deliveredAt ?? null, deliveredBy: c.deliveredBy ?? null,
    delivery: delivery ? deliveryView(delivery) : null,
    canDeliver: c.status === "APPROVED" && deliveryStatus === "YET_TO_DELIVER" && base.allocationActive && !base.changedSinceSubmission,
    deliveryHistory,
  };
}
