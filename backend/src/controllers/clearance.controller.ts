import type { NextFunction, Request, Response } from "express";
import { approveClearance, clearanceDetail, clearanceSummary, countUnviewedRejections, listClearances, markRejectionViewed, rejectClearance, resubmitClearance } from "../services/clearance.service.js";
import { sendResponse } from "../utils/sendResponse.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const q = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const id = (req: Request) => String(req.params.id);

// Shared by the RSA (Vehicle & Driver Clearance) and RBP (On-Road Vehicles) screens; the routes decide who may call what.
export const list = wrap(async (req, res) => {
  const data = await listClearances({
    q: q(req.query.q), status: q(req.query.status), projectType: q(req.query.projectType), from: q(req.query.from), to: q(req.query.to), page: n(req.query.page), limit: n(req.query.limit),
  });
  res.status(200).json(sendResponse(true, "Vehicle and driver clearances fetched successfully", data));
});

export const summary = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Clearance summary fetched successfully", await clearanceSummary(String(req.query.projectType ?? ""))));
});

export const detail = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Clearance details fetched successfully", await clearanceDetail(id(req))));
});

export const approve = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle and driver approved successfully", await approveClearance(id(req), req.body ?? {}, req.user!.username)));
});

export const reject = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle and driver rejected", await rejectClearance(id(req), req.body ?? {}, req.user!.username)));
});

export const resubmit = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Allocation resubmitted for RSA approval", await resubmitClearance(id(req), req.body ?? {}, req.user!.username)));
});

export const unviewedRejections = wrap(async (_req, res) => {
  res.status(200).json(sendResponse(true, "Unviewed rejections counted", await countUnviewedRejections()));
});
export const rejectionViewed = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Rejection marked as viewed", await markRejectionViewed(id(req), req.body?.version)));
});
