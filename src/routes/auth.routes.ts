import { Router } from "express";
import authController from "../controllers/auth.controller";

const router = Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/facebook/complete", authController.completeFacebookOnboarding);
router.get("/me", authController.me);

export default router;
