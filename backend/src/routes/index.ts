import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import trackingRoutes from "./tracking.routes.js";
import budgetRoutes from "./budget.routes.js";
import approvalRoutes from "./approval.routes.js";
import notificationRoutes from "./notification.routes.js";
import vehicleRoutes from "./vehicle.routes.js";
import allotmentRoutes from "./allotment.routes.js";
import driverRoutes from "./driver.routes.js";
import rsaRoutes from "./rsa.routes.js";

const router = Router();
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/tracking", trackingRoutes);
router.use("/budgets", budgetRoutes);
router.use("/approvals", approvalRoutes);
router.use("/notifications", notificationRoutes);
router.use("/vehicles", vehicleRoutes);
router.use("/vehicle-allotments", allotmentRoutes);
router.use("/drivers", driverRoutes);
router.use("/rsa", rsaRoutes);

export default router;
