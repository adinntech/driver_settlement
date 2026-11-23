import type { NextFunction, Request, Response } from "express";
import { createDriver, driverHistory, getDriver, listDrivers, updateDriver } from "../services/driver.service.js";
import { sendResponse } from "../utils/sendResponse.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const q = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

export const list = wrap(async (req, res) => {
  const data = await listDrivers({ q: q(req.query.q), availabilityStatus: q(req.query.availabilityStatus), page: n(req.query.page), limit: n(req.query.limit) });
  res.status(200).json(sendResponse(true, "Drivers fetched successfully", data));
});

export const one = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Driver fetched successfully", await getDriver(String(req.params.id))));
});

export const history = wrap(async (req, res) => {
  const data = await driverHistory(String(req.params.id), req.query.order === "asc");
  res.status(200).json(sendResponse(true, "Driver history fetched successfully", data));
});

export const create = wrap(async (req, res) => {
  res.status(201).json(sendResponse(true, "Driver created successfully", await createDriver(req.body ?? {}, req.user!.username)));
});

export const update = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Driver updated successfully", await updateDriver(String(req.params.id), req.body ?? {}, req.user!.username)));
});
