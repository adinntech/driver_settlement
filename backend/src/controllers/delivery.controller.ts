import type { NextFunction, Request, Response } from "express";
import { deliverVehicle, deliveryDetail, deliverySummary, uploadDeliveryPhoto } from "../services/delivery.service.js";
import { sendResponse } from "../utils/sendResponse.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const id = (req: Request) => String(req.params.id);

export const summary = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle delivery summary fetched successfully", await deliverySummary(String(req.query.projectType ?? ""))));
});

export const detail = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Vehicle delivery details fetched successfully", await deliveryDetail(id(req))));
});

export const photo = wrap(async (req, res) => {
  const data = await uploadDeliveryPhoto(id(req), String(req.params.kind), req.file, req.user!.username);
  res.status(201).json(sendResponse(true, "Photo uploaded successfully", data));
});

export const deliver = wrap(async (req, res) => {
  const r = await deliverVehicle(id(req), req.body ?? {}, req.user!.username);
  if (r.replay) res.status(200).json(sendResponse(true, "Vehicle was already delivered", r.delivery));
  else res.status(201).json(sendResponse(true, "Vehicle delivered successfully", r.delivery));
});
