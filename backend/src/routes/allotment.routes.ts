import { Router } from "express";
import { allot, assign, change, changeDrv, driverBank, driverLookup, drivers, saveDriverBank, extend, list, one, projects, release, vehicles } from "../controllers/allotment.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// Vehicle Allotment: RBP only. (Attachments are uploaded through the existing POST /api/vehicles/attachments.)
const router = Router();
router.use(authenticate, requireRole("RBP"));
router.get("/projects", projects);
router.get("/vehicles", vehicles);
router.get("/drivers", drivers);
router.get("/drivers/lookup", driverLookup);
router.get("/drivers/:driverId/bank", driverBank);
router.get("/", list);
router.post("/", allot);
router.get("/:id", one);
router.post("/:id/change-vehicle", change);
router.put("/:id/drivers/:driverId/bank", saveDriverBank);
router.post("/:id/assign-driver", assign);
router.post("/:id/change-driver", changeDrv);
router.put("/:id/schedule", extend);
router.post("/:id/release", release);

export default router;
