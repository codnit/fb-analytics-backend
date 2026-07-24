import { BaseRoute } from "../core/base.route";
import saveFacebookDataController from "../controllers/saveFacebookData.controller";
import adminAuth from "../middleware/adminAuth";
import facebookTokenExchange from "../middleware/auth";

export class SaveFacebookDataRoutes extends BaseRoute {
  protected registerRoutes(): void {
    this.router.post("/", facebookTokenExchange, saveFacebookDataController.initialConnectionSync);
    this.router.post(
      "/admin/partners/:partnerId/pages/:pageId/resync",
      adminAuth,
      saveFacebookDataController.syncStoredPageAsAdmin
    );
    this.router.get("/diagnostics", saveFacebookDataController.diagnostics);
    this.router.post("/dev/sync-page", saveFacebookDataController.syncPageManual);
  }
}

export default new SaveFacebookDataRoutes().getRouter();
