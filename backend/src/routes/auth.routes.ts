import { Router } from "express";
import { getMe, getRoles, postLogin } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.get("/roles", getRoles);
router.post("/login", postLogin);
router.get("/me", authenticate, getMe);

export default router;
