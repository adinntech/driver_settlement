import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  createVehicle, deleteDraft, getVehicle, listVehicles, updateVehicle, vehicleFilterOptions, vehicleHistory, vehicleSummary,
} from "../services/vehicle.service.js";
import { lookupApprovedProject, searchApprovedProjects } from "../services/availability.service.js";
import { MAX_UPLOAD_BYTES, storeUpload, type MediaFolder } from "../services/storage.service.js";
import { AppError } from "../utils/AppError.js";
import { sendResponse } from "../utils/sendResponse.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const q = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

export const list = wrap(async (req, res) => {
  const data = await listVehicles({
    q: q(req.query.q), type: q(req.query.type), make: q(req.query.make), model: q(req.query.model), year: n(req.query.year),
    insuranceStatus: q(req.query.insuranceStatus), fcStatus: q(req.query.fcStatus), batteryStatus: q(req.query.batteryStatus),
    stepneyStatus: q(req.query.stepneyStatus), status: q(req.query.status), from: q(req.query.from), to: q(req.query.to),
    page: n(req.query.page), limit: n(req.query.limit),
    docStatus: q(req.query.docStatus), docType: q(req.query.docType), availabilityStatus: q(req.query.availabilityStatus), projectType: q(req.query.projectType), clientName: q(req.query.clientName),
    vehicleNo: q(req.query.vehicleNo), nextAvailableFrom: q(req.query.nextAvailableFrom), nextAvailableTo: q(req.query.nextAvailableTo),
  });
  res.status(200).json(sendResponse(true, "Vehicles fetched successfully", data));
});

export const summary = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle summary fetched successfully", await vehicleSummary(new Date(), String(req.query.projectType ?? ""))));
});

export const filters = wrap(async (_req, res) => {
  res.status(200).json(sendResponse(true, "Filter options fetched successfully", await vehicleFilterOptions()));
});

/** Approved projects only (trackup / PIF / client / job sheet / type), paginated. Read-only. */
export const projects = wrap(async (req, res) => {
  const data = await searchApprovedProjects(q(req.query.q) ?? "", n(req.query.page), n(req.query.limit));
  res.status(200).json(sendResponse(true, "Approved projects fetched successfully", data));
});

/** Type a Trackup or PIF number, get the matching pair + project details (must be an approved project). */
export const projectLookup = wrap(async (req, res) => {
  const r = await lookupApprovedProject(q(req.query.trackup), q(req.query.pif));
  if ("error" in r) throw new AppError(r.error!, 400);
  res.status(200).json(sendResponse(true, "Approved project fetched successfully", r.choice));
});

export const one = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle fetched successfully", await getVehicle(String(req.params.id))));
});

export const create = wrap(async (req, res) => {
  const data = await createVehicle(req.body ?? {}, req.user!.username);
  const msg = data.status === "DRAFT" ? "Vehicle draft saved successfully" : "Vehicle saved successfully";
  res.status(201).json(sendResponse(true, msg, data));
});

export const update = wrap(async (req, res) => {
  const data = await updateVehicle(String(req.params.id), req.body ?? {}, req.user!.username);
  const msg = data.status === "DRAFT" ? "Vehicle draft saved successfully" : "Vehicle saved successfully";
  res.status(200).json(sendResponse(true, msg, data));
});

export const remove = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Draft deleted successfully", await deleteDraft(String(req.params.id), req.user!.username)));
});

export const history = wrap(async (req, res) => {
  const data = await vehicleHistory(String(req.params.id), req.query.order === "asc");
  res.status(200).json(sendResponse(true, "Vehicle history fetched successfully", data));
});

// ---- attachments (FC / Insurance / RTO / Police / Permit documents)
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).single("file");

/** Runs multer and turns its errors into the standard error response. */
export const receiveFile = (req: Request, res: Response, next: NextFunction) =>
  uploader(req, res, (err: unknown) => {
    if (!err) return next();
    if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") return next(new AppError("File is too large (maximum 10 MB)", 413));
    return next(new AppError("Invalid upload. Send one file in the \"file\" field", 400));
  });

/** RBP uploads: ?category= picks the media folder (vehicle documents by default). */
const RBP_FOLDERS: MediaFolder[] = ["vehicle-documents", "driver-licences", "allotment-changes"];
export const uploadAttachment = wrap(async (req, res) => {
  const c = req.query.category;
  if (c !== undefined && !RBP_FOLDERS.includes(c as MediaFolder)) throw new AppError(`Category must be one of ${RBP_FOLDERS.join(", ")}`, 400);
  const a = await storeUpload(req.file, (c as MediaFolder | undefined) ?? "vehicle-documents");
  res.status(201).json(sendResponse(true, "File uploaded successfully", a));
});

/** RSA clearance rejection evidence. */
export const uploadRejectionAttachment = wrap(async (req, res) => {
  const a = await storeUpload(req.file, "clearance-rejections");
  res.status(201).json(sendResponse(true, "File uploaded successfully", a));
});
