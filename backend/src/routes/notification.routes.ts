import { Router } from "express";
import { myNotifications, readAll, readOne } from "../controllers/approval.controller.js";
import { authenticate } from "../middleware/auth.js";

// Every signed-in user sees only their own notifications.
const router = Router();
router.use(authenticate);
router.get("/", myNotifications);
router.post("/read-all", readAll);
router.post("/:id/read", readOne);

export default router;
