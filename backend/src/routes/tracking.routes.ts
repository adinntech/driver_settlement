import { Router } from "express";
import { create, getOne, list, remove, stats } from "../controllers/tracking.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);
router.post("/", requireRole("RSOP"), create);
router.get("/stats", requireRole("RSOP", "RBP"), stats);
router.get("/", requireRole("RSOP", "RBP"), list);
router.get("/:id", requireRole("RSOP", "RBP"), getOne);
router.delete("/:id", requireRole("RSOP"), remove);

export default router;
