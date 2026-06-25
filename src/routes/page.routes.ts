import { BaseRoute } from "../core/base.route";
import pageController from "../controllers/page.controller";
import pageInsightsController from "../controllers/page_insights.controller";
import adminAuth from "../middleware/adminAuth";

export class PageRoutes extends BaseRoute {
  protected registerRoutes(): void {
    this.router.get("/partner/:partnerId", pageController.getPartnerPages);
    this.router.get("/:fbPageId/insights/:since/:until", pageInsightsController.getPageInsights);
    this.router.get("/:fbPageId/insights/:metricName/:since/:until", pageInsightsController.getPageMetrics);
    this.router.get("/admin/all", adminAuth, pageController.getAllPages);
    this.router.get("/:pageId", pageController.getPageById);
    this.router.post("/", pageController.createPage);
    this.router.post("/:fbPageId/insights", pageInsightsController.createPageInsight);
  }
}

export default new PageRoutes().getRouter();
