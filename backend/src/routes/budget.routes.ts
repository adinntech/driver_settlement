import { Router } from "express";
import { create, getForVehicle, rejectionViewed, unviewedRejections, update, version, versions } from "../controllers/budget.controller.js";
import { events, submit } from "../controllers/approval.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireRole("RBP"));
router.get("/vehicle/:vehicleId", getForVehicle);
router.get("/rejections/unviewed", unviewedRejections);
router.post("/:id/rejection-viewed", rejectionViewed);
router.post("/", create);
router.put("/:id", update);
router.post("/:id/submit", submit);
router.get("/:id/events", events);
router.get("/:id/versions", versions);
router.get("/:id/versions/:version", version);

export default router;
