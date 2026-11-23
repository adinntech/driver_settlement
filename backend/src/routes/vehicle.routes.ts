import { Router } from "express";
import { create, filters, history, list, one, projectLookup, projects, receiveFile, remove, summary, update, uploadAttachment } from "../controllers/vehicle.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// Vehicle Management: RBP only.
const router = Router();
router.use(authenticate, requireRole("RBP"));
router.get("/summary", summary);
router.get("/filters", filters);
router.get("/projects", projects);
router.get("/projects/lookup", projectLookup);
router.post("/attachments", receiveFile, uploadAttachment);
router.get("/", list);
router.post("/", create);
router.get("/:id/history", history);
router.get("/:id", one);
router.put("/:id", update);
router.delete("/:id", remove);

export default router;
