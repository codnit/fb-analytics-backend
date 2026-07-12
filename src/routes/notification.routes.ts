import { Router } from "express";
import notificationController from "../controllers/notification.controller";
import partnerAuth from "../middleware/partnerAuth";

const router = Router();

router.use(partnerAuth);
router.get("/", notificationController.list);
router.get("/stream", notificationController.stream);
router.patch("/:notificationId/read", notificationController.markRead);
router.patch("/read-all", notificationController.markAllRead);

export default router;
