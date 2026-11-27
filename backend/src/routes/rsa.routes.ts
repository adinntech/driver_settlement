import { Router } from "express";
import { advanceEligibility, budget, context, create, driver, history, options, payment, payments, projects, summary } from "../controllers/rsa.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

// RSA (Roadshow Accounts) only. Everything here is read-only except the creation of RSA's own payment entries.
const router = Router();
router.use(authenticate, requireRole("RSA"));
router.get("/options", options);
router.get("/projects", projects);
router.get("/projects/:tvId", context);
router.get("/projects/:tvId/payments", payments);
router.post("/projects/:tvId/payments", create);
router.get("/projects/:tvId/budget", budget);
router.get("/projects/:tvId/driver", driver);
router.get("/projects/:tvId/advance-eligibility", advanceEligibility);
router.get("/payments", history);
router.get("/payments/summary", summary);
router.get("/payments/:id", payment);

export default router;
