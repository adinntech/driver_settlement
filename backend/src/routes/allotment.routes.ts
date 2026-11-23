import { Router } from "express";
import { allot, change, extend, list, one, projects, release, vehicles } from "../controllers/allotment.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// Vehicle Allotment: RBP only. (Attachments are uploaded through the existing POST /api/vehicles/attachments.)
const router = Router();
router.use(authenticate, requireRole("RBP"));
router.get("/projects", projects);
router.get("/vehicles", vehicles);
router.get("/", list);
router.post("/", allot);
router.get("/:id", one);
router.post("/:id/change-vehicle", change);
router.put("/:id/schedule", extend);
router.post("/:id/release", release);

export default router;
