import { Router } from "express";
import { getDemoCredentials, getMe, getRoles, postLogin } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
const router = Router();
router.get("/roles", getRoles);
router.post("/login", postLogin);
router.get("/demo-credentials", getDemoCredentials); // development-only, opt-in (DEMO_LOGIN_HINTS=true); 404 otherwise
router.get("/me", authenticate, getMe);
export default router;
