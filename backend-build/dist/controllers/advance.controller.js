import { getAdvance, listAdvances, submitAdvance } from "../services/advance.service.js";
import { sendResponse } from "../utils/sendResponse.js";
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const n = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
export const submit = wrap(async (req, res) => {
    const r = await submitAdvance(String(req.params.id), req.body ?? {}, req.user.username);
    if (r.replay)
        res.status(200).json(sendResponse(true, "Advance was already submitted", r.advance));
    else
        res.status(201).json(sendResponse(true, "Advance submitted successfully", r.advance));
});
export const list = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Advance history fetched successfully", await listAdvances(String(req.params.id), { page: n(req.query.page), limit: n(req.query.limit) })));
});
export const one = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Advance fetched successfully", await getAdvance(String(req.params.id), String(req.params.advanceId))));
});
