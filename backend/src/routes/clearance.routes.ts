import { Router } from "express";
import { approve, detail, list, reject, rejectionViewed, resubmit, summary, unviewedRejections } from "../controllers/clearance.controller.js";
import { deliver, detail as deliveryDetail, photo, summary as deliverySummary } from "../controllers/delivery.controller.js";
import { receiveFile, uploadRejectionAttachment } from "../controllers/vehicle.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";

/** RSA Vehicle & Driver Clearance: only RSA lists, reviews, approves and rejects. */
export const rsaClearanceRoutes = Router();
rsaClearanceRoutes.use(authenticate, requireRole("RSA"));
rsaClearanceRoutes.get("/", list);
rsaClearanceRoutes.get("/summary", summary);
rsaClearanceRoutes.post("/attachments", receiveFile, uploadRejectionAttachment); // rejection evidence: the same upload and checks as /vehicles/attachments
rsaClearanceRoutes.get("/:id", detail);
rsaClearanceRoutes.post("/:id/approve", approve);
rsaClearanceRoutes.post("/:id/reject", reject);

/** RBP Vehicle Deliver (On-Road Vehicles): status screens, resubmission of a rejected allocation and vehicle delivery. */
export const onRoadRoutes = Router();
onRoadRoutes.use(authenticate, requireRole("RBP"));
onRoadRoutes.get("/", list);
onRoadRoutes.get("/summary", deliverySummary); // adds the delivery counts to the clearance counts
onRoadRoutes.get("/rejections/unviewed", unviewedRejections); // before "/:id"
onRoadRoutes.post("/:id/rejection-viewed", rejectionViewed);
onRoadRoutes.get("/:id", deliveryDetail); // the clearance detail plus delivery information
onRoadRoutes.post("/:id/photos/:kind", receiveFile, photo);
onRoadRoutes.post("/:id/deliver", deliver);
onRoadRoutes.post("/:id/resubmit", resubmit);
