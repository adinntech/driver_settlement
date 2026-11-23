import type { NextFunction, Request, Response } from "express";
import {
  allotVehicle, allotmentDetail, changeVehicle, extendAllotment, listAllotmentProjects, listAllotments, releaseAllotment, searchAvailableVehicles,
} from "../services/allotment.service.js";
import { sendResponse } from "../utils/sendResponse.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const q = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

export const projects = wrap(async (req, res) => {
  const data = await listAllotmentProjects(q(req.query.q) ?? "", n(req.query.page), n(req.query.limit));
  res.status(200).json(sendResponse(true, "Approved projects fetched successfully", data));
});

export const vehicles = wrap(async (req, res) => {
  const data = await searchAvailableVehicles(q(req.query.q) ?? "", n(req.query.limit));
  res.status(200).json(sendResponse(true, "Available vehicles fetched successfully", data));
});

export const list = wrap(async (req, res) => {
  const data = await listAllotments({
    q: q(req.query.q), vehicleNo: q(req.query.vehicleNo), clientName: q(req.query.clientName), trackupNumber: q(req.query.trackupNumber),
    pifNumber: q(req.query.pifNumber), projectType: q(req.query.projectType), status: q(req.query.status), from: q(req.query.from), to: q(req.query.to),
    page: n(req.query.page), limit: n(req.query.limit),
  });
  res.status(200).json(sendResponse(true, "Allotments fetched successfully", data));
});

export const one = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Allotment fetched successfully", await allotmentDetail(String(req.params.id))));
});

export const allot = wrap(async (req, res) => {
  res.status(201).json(sendResponse(true, "Vehicle allotted successfully", await allotVehicle(req.body ?? {}, req.user!.username)));
});

export const change = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle changed successfully", await changeVehicle(String(req.params.id), req.body ?? {}, req.user!.username)));
});

export const extend = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Allotment updated successfully", await extendAllotment(String(req.params.id), req.body ?? {}, req.user!.username)));
});

export const release = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle released successfully", await releaseAllotment(String(req.params.id), req.body ?? {}, req.user!.username)));
});
