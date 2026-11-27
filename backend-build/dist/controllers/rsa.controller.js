import { rsaOptions } from "../config/rsaOptions.js";
import { checkAdvanceEligibility, createPayment, getPayment, listAllPayments, listEligibleProjects, listPayments, paymentSummary, projectContext, viewBudget, viewDriver, } from "../services/rsa.service.js";
import { sendResponse } from "../utils/sendResponse.js";
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const q = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const tv = (req) => String(req.params.tvId);
export const options = wrap(async (_req, res) => {
    res.status(200).json(sendResponse(true, "Payment options fetched successfully", rsaOptions()));
});
export const projects = wrap(async (req, res) => {
    const data = await listEligibleProjects({
        q: q(req.query.q), projectType: q(req.query.projectType), paymentStatus: q(req.query.paymentStatus), from: q(req.query.from), to: q(req.query.to),
        page: n(req.query.page), limit: n(req.query.limit),
    });
    res.status(200).json(sendResponse(true, "Eligible projects fetched successfully", data));
});
export const context = wrap(async (req, res) => {
    const { _raw, ...data } = await projectContext(tv(req));
    void _raw;
    res.status(200).json(sendResponse(true, "Project details fetched successfully", data));
});
export const payments = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Payment history fetched successfully", await listPayments(tv(req), { page: n(req.query.page), limit: n(req.query.limit) })));
});
export const history = wrap(async (req, res) => {
    const data = await listAllPayments({
        q: q(req.query.q), paymentFor: q(req.query.paymentFor), from: q(req.query.from), to: q(req.query.to), createdBy: q(req.query.createdBy), paymentStatus: q(req.query.paymentStatus),
        page: n(req.query.page), limit: n(req.query.limit),
    });
    res.status(200).json(sendResponse(true, "Payment history fetched successfully", data));
});
export const summary = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Payment summary fetched successfully", await paymentSummary(String(req.query.projectType ?? ""))));
});
export const payment = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Payment fetched successfully", await getPayment(String(req.params.id))));
});
export const create = wrap(async (req, res) => {
    const r = await createPayment(tv(req), req.body ?? {}, req.user.username);
    if (r.replay)
        res.status(200).json(sendResponse(true, "Payment was already saved", r.payment));
    else
        res.status(201).json(sendResponse(true, "Payment saved successfully", r.payment));
});
export const budget = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Budget fetched successfully", await viewBudget(tv(req))));
});
export const driver = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Driver details fetched successfully", await viewDriver(tv(req))));
});
export const advanceEligibility = wrap(async (req, res) => {
    res.status(200).json(sendResponse(true, "Advance eligibility calculated successfully", await checkAdvanceEligibility(tv(req), req.query.workingDays)));
});
