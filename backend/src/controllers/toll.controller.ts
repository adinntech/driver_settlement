import type { NextFunction, Request, Response } from "express";
import { isTollVehicleClass, tollDirectory } from "../services/toll.service.js";
import { AppError } from "../utils/AppError.js";
import { sendResponse } from "../utils/sendResponse.js";

/** GET /api/tolls/search?q=<plaza, state, NH or place>&vehicleClass=<TollVehicleClass> */
export const search = (req: Request, res: Response, next: NextFunction) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const cls = req.query.vehicleClass;
  if (!isTollVehicleClass(cls)) return next(new AppError("Choose the toll vehicle class first", 400));
  if (q.length < 2) return void res.status(200).json(sendResponse(true, "Enter at least 2 characters", { source: null, results: [] }));
  tollDirectory()
    .search(q, cls)
    .then((data) => res.status(200).json(sendResponse(true, "Toll plazas fetched successfully", data)))
    .catch(next);
};
