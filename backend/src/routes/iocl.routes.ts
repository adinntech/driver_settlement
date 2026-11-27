import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../middleware/auth.js";
import { exportIocl, importIocl, listIocl } from "../services/iocl.service.js";
import { AppError } from "../utils/AppError.js";
import { sendResponse } from "../utils/sendResponse.js";

/** IOCL Data: RSA only. */
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const q = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const query = (req: Request) => ({ projectType: q(req.query.projectType), from: q(req.query.from), to: q(req.query.to), vehicleNo: q(req.query.vehicleNo), product: q(req.query.product), page: n(req.query.page), limit: n(req.query.limit) });

const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single("file");
const receive = (req: Request, res: Response, next: NextFunction) =>
  uploader(req, res, (err: unknown) => {
    if (!err) return next();
    if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") return next(new AppError("File is too large (maximum 5 MB)", 413));
    return next(new AppError("Invalid upload. Send one file in the \"file\" field", 400));
  });

const router = Router();
router.use(authenticate, requireRole("RSA"));

router.get("/", wrap(async (req, res) => void res.json(sendResponse(true, "IOCL transactions fetched", await listIocl(query(req))))));
router.post("/import", receive, wrap(async (req, res) => {
  const r = await importIocl(req.file, req.user!.username);
  res.status(201).json(sendResponse(true, "IOCL statement processed", r));
}));
router.get("/export", wrap(async (req, res) => {
  const r = await exportIocl(query(req));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${r.name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(r.buffer);
}));

export default router;
