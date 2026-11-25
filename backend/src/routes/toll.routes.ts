import { Router } from "express";
import { search } from "../controllers/toll.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireRole("RBP"));
router.get("/search", search);

export default router;
