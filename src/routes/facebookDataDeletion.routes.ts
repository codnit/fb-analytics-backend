import { BaseRoute } from "../core/base.route";
import facebookDataDeletionController from "../controllers/facebookDataDeletion.controller";

export class FacebookDataDeletionRoutes extends BaseRoute {
  protected registerRoutes(): void {
    this.router.post("/", facebookDataDeletionController.callback);
    this.router.get("/status/:confirmationCode", facebookDataDeletionController.status);
  }
}

export default new FacebookDataDeletionRoutes().getRouter();

