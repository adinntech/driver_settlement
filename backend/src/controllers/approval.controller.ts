import type { NextFunction, Request, Response } from "express";
import {
  approvalStats, approveBudget, listApprovals, listEvents, rejectBudget, reviewDetail, submitBudget,
} from "../services/approval.service.js";
import { listNotifications, markAllRead, markRead } from "../services/notification.service.js";
import { sendResponse } from "../utils/sendResponse.js";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const q = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const n = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

// ---- RSOM
export const list = wrap(async (req, res) => {
  const data = await listApprovals({
    status: q(req.query.status), projectType: q(req.query.projectType), client: q(req.query.client),
    trackup: q(req.query.trackup), pif: q(req.query.pif), from: q(req.query.from), to: q(req.query.to),
    page: n(req.query.page), limit: n(req.query.limit),
  });
  res.status(200).json(sendResponse(true, "Budgets fetched successfully", data));
});

export const stats = wrap(async (_req, res) => {
  res.status(200).json(sendResponse(true, "Approval summary fetched successfully", await approvalStats()));
});

export const detail = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Budget review fetched successfully", await reviewDetail(String(req.params.id), req.query.order === "desc")));
});

export const approve = wrap(async (req, res) => {
  const data = await approveBudget(String(req.params.id), req.body?.version, req.user!.username);
  res.status(200).json(sendResponse(true, "Budget approved successfully", data));
});

export const reject = wrap(async (req, res) => {
  const { version, reason, fields } = req.body ?? {};
  const data = await rejectBudget(String(req.params.id), { version, reason, fields }, req.user!.username);
  res.status(200).json(sendResponse(true, "Budget rejected successfully", data));
});

// ---- RBP
export const submit = wrap(async (req, res) => {
  const data = await submitBudget(String(req.params.id), req.user!.username, req.body?.comment);
  res.status(200).json(sendResponse(true, "Budget submitted for approval", data));
});

export const events = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Budget history fetched successfully", await listEvents(String(req.params.id), req.query.order === "desc")));
});

// ---- notifications (any signed-in user, own only)
export const myNotifications = wrap(async (req, res) => {
  const data = await listNotifications(req.user!.id, req.query.unread === "true");
  res.status(200).json(sendResponse(true, "Notifications fetched successfully", data));
});

export const readOne = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "Notification marked as read", await markRead(req.user!.id, String(req.params.id))));
});

export const readAll = wrap(async (req, res) => {
  res.status(200).json(sendResponse(true, "All notifications marked as read", await markAllRead(req.user!.id)));
});
