import { BaseRoute } from "../core/base.route";
import queueController from "../controllers/queue.controller";

export class QueueRoutes extends BaseRoute {
  protected registerRoutes(): void {
    this.router.post("/reset", queueController.resetAll);
    this.router.get("/status", queueController.getStatus);
  }
}

export default new QueueRoutes().getRouter();
