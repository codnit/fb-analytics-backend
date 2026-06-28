import { BaseRoute } from "../core/base.route";
import partnerController from "../controllers/partner.controller";
import adminAuth from "../middleware/adminAuth";

export class PartnerRoutes extends BaseRoute {
  protected registerRoutes(): void {
    this.router.get("/user/:userId", partnerController.getPartnerByUserId);
    this.router.get("/", adminAuth, partnerController.getAllPartners);
    this.router.get("/:partnerId", partnerController.getPartnerById);
    this.router.post("/", partnerController.createPartner);
  }
}

export default new PartnerRoutes().getRouter();
