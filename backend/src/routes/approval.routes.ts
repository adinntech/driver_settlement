import { Router } from "express";
import { approve, detail, list, reject, stats } from "../controllers/approval.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// RSOM only: review, approve and reject submitted budgets.
const router = Router();
router.use(authenticate, requireRole("RSOM"));
router.get("/stats", stats);
router.get("/", list);
router.get("/:id", detail);
router.post("/:id/approve", approve);
router.post("/:id/reject", reject);

export default router;
