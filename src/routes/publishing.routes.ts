import { Router } from "express";
import publishingController from "../controllers/publishing.controller";
import publishingAuth from "../middleware/publishingAuth";

class PublishingRoutes {
  public router = Router();

  constructor() {
    this.router.use(publishingAuth);
    this.router.get("/pages", publishingController.getPages);
    this.router.post("/media/upload", publishingController.uploadMedia);
    this.router.post("/posts", publishingController.createPost);
    this.router.get("/pages/:pageId/posts", publishingController.listPosts);
    this.router.patch("/posts/:postId", publishingController.updatePost);
    this.router.post("/posts/:postId/retry", publishingController.retryPost);
    this.router.delete("/posts/:postId", publishingController.deletePost);
  }
}

export default new PublishingRoutes().router;
