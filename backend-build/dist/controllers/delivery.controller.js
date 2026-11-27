import { deliverVehicle, deliveryDetail, deliverySummary, uploadDeliveryPhoto } from "../services/delivery.service.js";
import { sendResponse } from "../utils/sendResponse.js";
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const id = (req) => String(req.params.id);
export const summary = wrap(async (_req, res) => {
    res.status(200).json(sendResponse(true, "Vehicle delivery summary fetched successfully", await deliverySummary()));
});
export const detail = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Vehicle delivery details fetched successfully", await deliveryDetail(id(req))));
});
export const photo = wrap(async (req, res) => {
    const data = await uploadDeliveryPhoto(id(req), String(req.params.kind), req.file, req.user.username);
    res.status(201).json(sendResponse(true, "Photo uploaded successfully", data));
});
export const deliver = wrap(async (req, res) => {
    const r = await deliverVehicle(id(req), req.body ?? {}, req.user.username);
    if (r.replay)
        res.status(200).json(sendResponse(true, "Vehicle was already delivered", r.delivery));
    else
        res.status(201).json(sendResponse(true, "Vehicle delivered successfully", r.delivery));
});
