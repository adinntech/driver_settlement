import { createTracking, listTracking, loadProject, trackingStats, } from "../services/tracking.service.js";
import { sendResponse } from "../utils/sendResponse.js";
const q = (v) => (typeof v === "string" && v ? v : undefined);
export const create = async (req, res, next) => {
    try {
        const user = req.user;
        const data = await createTracking({ id: user.id, username: user.username }, req.body ?? {});
        res.status(201).json(sendResponse(true, "Tracking request created successfully", data));
    }
    catch (e) {
        next(e);
    }
};
export const list = async (req, res, next) => {
    try {
        const data = await listTracking({
            q: q(req.query.q),
            projectType: q(req.query.projectType),
            from: q(req.query.from),
            to: q(req.query.to),
        });
        res.status(200).json(sendResponse(true, "Tracking requests fetched successfully", data));
    }
    catch (e) {
        next(e);
    }
};
export const stats = async (_req, res, next) => {
    try {
        res.status(200).json(sendResponse(true, "Stats fetched successfully", await trackingStats()));
    }
    catch (e) {
        next(e);
    }
};
export const getOne = async (req, res, next) => {
    try {
        const id = String(req.params.id);
        if (!/^[a-f0-9]{24}$/i.test(id)) {
            res.status(400).json(sendResponse(false, "Invalid tracking id", null));
            return;
        }
        res
            .status(200)
            .json(sendResponse(true, "Tracking request fetched successfully", await loadProject(id)));
    }
    catch (e) {
        next(e);
    }
};
