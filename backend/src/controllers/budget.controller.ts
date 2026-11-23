import type { NextFunction, Request, Response } from "express";
import {
  createBudget,
  getVehicleBudget,
  getVersion,
  listVersions,
  updateBudget,
} from "../services/budget.service.js";
import { sendResponse } from "../utils/sendResponse.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export const getForVehicle = wrap(async (req, res) => {
  const data = await getVehicleBudget(String(req.params.vehicleId));
  res.status(200).json(sendResponse(true, "Budget details fetched successfully", data));
});

export const create = wrap(async (req, res) => {
  const { vehicleId, ...rest } = req.body ?? {};
  const data = await createBudget(String(vehicleId ?? ""), rest, req.user!.username);
  res.status(201).json(sendResponse(true, "Budget created successfully", data));
});

export const update = wrap(async (req, res) => {
  const data = await updateBudget(String(req.params.id), req.body ?? {}, req.user!.username);
  res.status(200).json(sendResponse(true, "Budget updated successfully", data));
});

export const versions = wrap(async (req, res) => {
  const data = await listVersions(String(req.params.id), req.query.order === "desc");
  res.status(200).json(sendResponse(true, "Budget versions fetched successfully", data));
});

export const version = wrap(async (req, res) => {
  const n = Number(req.params.version);
  if (!Number.isInteger(n) || n < 1) {
    res.status(400).json(sendResponse(false, "Invalid version number", null));
    return;
  }
  const data = await getVersion(String(req.params.id), n);
  res.status(200).json(sendResponse(true, "Budget version fetched successfully", data));
});
