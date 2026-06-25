import { BaseRoute } from "../core/base.route";
import adminAuthController from "../controllers/adminAuth.controller";

export class AdminRoutes extends BaseRoute {
  protected registerRoutes(): void {
    this.router.post("/login", adminAuthController.login);
    this.router.post("/forgot-password", adminAuthController.forgotPassword);
    this.router.post("/reset-password", adminAuthController.resetPassword);
  }
}

export default new AdminRoutes().getRouter();
