import { Router } from "express";
import { create, history, list, one, update } from "../controllers/driver.controller.js";
import { list as listAdvances, one as oneAdvance, submit as submitAdvance } from "../controllers/advance.controller.js";
import { importHandlers } from "../controllers/import.controller.js";
import { receiveFile } from "../controllers/vehicle.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";
// Driver Management: RBP only. (Licence attachments use the existing POST /api/vehicles/attachments upload.)
const router = Router();
router.use(authenticate, requireRole("RBP"));
router.get("/", list);
// Excel bulk import: template, row-wise validation preview, import (before "/:id")
const driverImport = importHandlers("drivers");
router.get("/import/template", driverImport.template);
router.post("/import/preview", receiveFile, driverImport.preview);
router.post("/import", receiveFile, driverImport.run);
router.post("/", create);
router.get("/:id/history", history);
router.get("/:id/advances", listAdvances);
router.post("/:id/advances", submitAdvance);
router.get("/:id/advances/:advanceId", oneAdvance);
router.get("/:id", one);
router.put("/:id", update);
export default router;
