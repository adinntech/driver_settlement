import { Router, type NextFunction, type Request, type Response } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  approvedForExport, checkAdvanceEligibility, completeBulk, completeSettlement,getSettlement, listEligibleProjects, listSettlements, paymentsForExport, resubmitSettlement, reviewSettlement, settlementContext,
  settlementOptions, submitSettlement, viewBudget, viewDriver,
} from "../services/settlement.service.js";
import { accountsExport, approvedPaymentRows, driverListRows, driverSalaryPdf, driverSalaryRows, reportWorkbook, vehicleMisRows } from "../services/settlementReports.service.js";
import { listOnRoadVehicles } from "../services/onRoad.service.js";
import { sendResponse } from "../utils/sendResponse.js";
import { AppError } from "../utils/AppError.js";

/**
 * Settlement payments (daily vehicle payments + final driver settlements).
 *   RBP: create / resubmit · RSOM: decide DAILY · RSO: decide FINAL + reports + salary PDF · RSA: queue, export, complete.
 */
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const q = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const ok = (res: Response, msg: string, data: unknown, code = 200) => res.status(code).json(sendResponse(true, msg, data));
const xlsx = (res: Response, name: string, buf: Buffer) => {
  const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-${stamp}.xlsx"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(buf);
};
const reportQ = (req: Request) => ({ from: q(req.query.from), to: q(req.query.to), category: q(req.query.category), q: q(req.query.q) });

const router = Router();
router.use(authenticate);
const ALL = requireRole("RBP", "RSOM", "RSO", "RSA");

router.get("/options", ALL, wrap(async (_req, res) => void ok(res, "Options fetched", settlementOptions())));

// ---- RBP: project picker + read-only side panels + submit
const ENTRY = requireRole("RBP", "RSA"); // the shared Driver Payments module
router.get("/projects", ENTRY, wrap(async (req, res) => {
  ok(res, "Eligible projects fetched", await listEligibleProjects({ q: q(req.query.q), projectType: q(req.query.projectType), page: n(req.query.page), limit: n(req.query.limit), forFinal: req.query.kind === "final" }));
}));
// On Road Vehicles tab (RBP + RSA): delivered vehicles still on road; daily payments open the existing entry form below.
router.get("/on-road", ENTRY, wrap(async (req, res) => {
  ok(res, "On road vehicles fetched", await listOnRoadVehicles({ q: q(req.query.q), projectType: q(req.query.projectType), page: n(req.query.page), limit: n(req.query.limit) }));
}));
router.get("/projects/:tvId", ENTRY, wrap(async (req, res) => void ok(res, "Project fetched", await settlementContext(String(req.params.tvId)))));
router.get("/projects/:tvId/budget", ENTRY, wrap(async (req, res) => void ok(res, "Budget fetched", await viewBudget(String(req.params.tvId)))));
router.get("/projects/:tvId/driver", ENTRY, wrap(async (req, res) => void ok(res, "Driver fetched", await viewDriver(String(req.params.tvId)))));
router.get("/projects/:tvId/advance-eligibility", ENTRY, wrap(async (req, res) => {
  ok(res, "Advance eligibility calculated", await checkAdvanceEligibility(String(req.params.tvId), req.query.workingDays));
}));
for (const [path, category] of [["daily", "DAILY"], ["final", "FINAL"]] as const)
  router.post(`/projects/:tvId/${path}`, ENTRY, wrap(async (req, res) => {
    const r = await submitSettlement(category, String(req.params.tvId), req.body ?? {}, req.user!.username, req.user!.role as "RBP" | "RSA");
    ok(res, r.replay ? "Payment was already submitted" : "Payment submitted for approval", r.payment, r.replay ? 200 : 201);
  }));

// ---- common approval queue (each role sees it; actions are checked per category)
router.get("/", ALL, wrap(async (req, res) => {
  ok(res, "Payments fetched", await listSettlements({
    scope: q(req.query.scope), category: q(req.query.category), status: q(req.query.status), q: q(req.query.q), from: q(req.query.from), to: q(req.query.to), projectType: q(req.query.projectType),
    page: n(req.query.page), limit: n(req.query.limit), sort: q(req.query.sort), dir: q(req.query.dir), approvedOn: q(req.query.approvedOn),
  }, req.user!.role));
}));

// ---- RSA: Bulk Entry (the single completion below, once per payment)
router.post("/complete-bulk", requireRole("RSA"), wrap(async (req, res) => {
  ok(res, "Bulk entry processed", await completeBulk(req.body, req.user!.username));
}));

// ---- RSA: accounts export (all approved) and the export of whatever the table is filtered to
router.get("/export/approved", requireRole("RSA"), wrap(async (req, res) => {
  const rows = await approvedForExport(req.user!.username);
  if (!rows.length) throw new AppError("There are no approved payments to export", 404);
  xlsx(res, "approved-payments", await accountsExport(rows));
}));
router.get("/export/filtered", requireRole("RSA"), wrap(async (req, res) => {
  const rows = await paymentsForExport({ category: q(req.query.category), status: q(req.query.status), q: q(req.query.q), from: q(req.query.from), to: q(req.query.to) }, req.user!.username);
  if (!rows.length) throw new AppError("There are no payments matching the current filters", 404);
  xlsx(res, "filtered-payments", await accountsExport(rows, "Payments"));
}));

// ---- RSO reports: JSON for the screens, Excel per report
const REPORTS: Record<string, (rq: ReturnType<typeof reportQ>) => Promise<unknown[]>> = {
  "approved-payments": (rq) => approvedPaymentRows(rq), "vehicle-mis": vehicleMisRows, "driver-list": driverListRows, "driver-salary": driverSalaryRows,
};
router.get("/reports/:kind", requireRole("RSO"), wrap(async (req, res) => {
  const fn = REPORTS[String(req.params.kind)];
  if (!fn) throw new AppError("Unknown report", 404);
  ok(res, "Report fetched", await fn(reportQ(req)));
}));
router.get("/reports/:kind/export", requireRole("RSO"), wrap(async (req, res) => {
  const r = await reportWorkbook(String(req.params.kind), reportQ(req));
  xlsx(res, r.name, r.buffer);
}));

// ---- one payment
router.get("/:id", ALL, wrap(async (req, res) => {
  const payment = await getSettlement(String(req.params.id)); // one shared record: every role that may open it sees the same details and history
  if (req.user!.role === "RSOM" && payment.category !== "DAILY") throw new AppError("RSOM can view daily vehicle payments only", 403);
  ok(res, "Payment fetched", payment);
}));
router.get("/:id/salary-pdf", requireRole("RSO", "RSA"), wrap(async (req, res) => {
  const r = await driverSalaryPdf(String(req.params.id));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${r.name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(r.buffer);
}));
router.post("/:id/resubmit", ENTRY, wrap(async (req, res) => {
  ok(res, "Payment resubmitted for approval", await resubmitSettlement(String(req.params.id), req.body ?? {}, req.user!.username, req.body?.comment, req.user!.role as "RBP" | "RSA"));
}));
router.post("/:id/approve", requireRole("RSOM", "RSO"), wrap(async (req, res) => {
  ok(res, "Payment approved", await reviewSettlement(String(req.params.id), "APPROVE", req.user!, { comment: req.body?.comment, version: req.body?.version }));
}));
router.post("/:id/reject", requireRole("RSOM", "RSO"), wrap(async (req, res) => {
  ok(res, "Payment rejected", await reviewSettlement(String(req.params.id), "REJECT", req.user!, { reason: req.body?.reason, version: req.body?.version }));
}));
router.post("/:id/complete", requireRole("RSA"), wrap(async (req, res) => {
  ok(res, "Payment marked completed", await completeSettlement(String(req.params.id), req.body ?? {}, req.user!.username));
}));

export default router;
