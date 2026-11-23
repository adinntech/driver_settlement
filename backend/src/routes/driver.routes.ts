import { Router } from "express";
import { create, history, list, one, update } from "../controllers/driver.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// Driver Management: RBP only. (Licence attachments use the existing POST /api/vehicles/attachments upload.)
const router = Router();
router.use(authenticate, requireRole("RBP"));
router.get("/", list);
router.post("/", create);
router.get("/:id/history", history);
router.get("/:id", one);
router.put("/:id", update);

export default router;
