import type { NextFunction, Request, Response } from "express";
import fs from "fs";
import { promises as fsPromises } from "fs";
import { BaseController } from "../core/base.controller";
import publishingService from "../services/facebook/publishing.service";

const { IncomingForm } = require("formidable");

const getActor = (req: Request): { id: string; type: string } => {
  return (req as any).publishingActor || { id: "unknown", type: "api" };
};

export class PublishingController extends BaseController {
  getPages = async (_req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const pages = await publishingService.listPublishingPages();
      return this.ok(
        res,
        pages.map((page) => ({
          id: page.id,
          partner_id: page.partner_id,
          fb_page_id: page.fb_page_id,
          page_name: page.page_name,
          picture_url: page.picture_url,
          category: page.category,
          publishing_enabled: Boolean(page.publishing_enabled),
          publishing_granted_at: page.publishing_granted_at || null,
          publishing_granted_by: page.publishing_granted_by || null,
        })),
        "Publishing pages retrieved successfully"
      );
    } catch (error) {
      return next(error);
    }
  };

  createPost = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const actor = getActor(req);
      const body = req.body as {
        pageId?: string;
        page_id?: string;
        postType?: "text" | "link" | "photo" | "video";
        post_type?: "text" | "link" | "photo" | "video";
        message?: string;
        link?: string;
        mediaUrl?: string;
        media_url?: string;
        mediaObjectKey?: string;
        media_object_key?: string;
        scheduledPublishTime?: string;
        scheduled_publish_time?: string;
      };

      const pageId = body.pageId || body.page_id;
      const postType = body.postType || body.post_type || "text";

      if (!pageId) return this.badRequest(res, "pageId is required");

      const post = await publishingService.publishPost({
        pageId,
        postType,
        message: body.message,
        link: body.link,
        mediaUrl: body.mediaUrl || body.media_url,
        mediaObjectKey: body.mediaObjectKey || body.media_object_key,
        scheduledPublishTime: body.scheduledPublishTime || body.scheduled_publish_time,
        createdBy: actor.id,
        createdVia: actor.type,
      });

      return this.created(res, post, "Post submitted successfully");
    } catch (error) {
      return next(error);
    }
  };

  uploadMedia = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const form = new IncomingForm({
      multiples: false,
      maxFileSize: 512 * 1024 * 1024,
      keepExtensions: true,
    });

    form.parse(req, async (error: Error | null, fields: Record<string, unknown>, files: Record<string, unknown>) => {
      if (error) {
        return next(error);
      }

      try {
        const pageIdValue = fields.pageId || fields.page_id;
        const pageId = Array.isArray(pageIdValue) ? pageIdValue[0] : pageIdValue;
        const fileValue = files.file || files.media;
        const file = Array.isArray(fileValue) ? fileValue[0] : fileValue as any;

        if (!pageId || typeof pageId !== "string") {
          return this.badRequest(res, "pageId is required");
        }

        if (!file?.filepath) {
          return this.badRequest(res, "media file is required");
        }

        const contentType = file.mimetype || "application/octet-stream";
        if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
          return this.badRequest(res, "Only image and video uploads are supported");
        }

        const upload = await publishingService.uploadMedia({
          pageId,
          filename: file.originalFilename || file.newFilename || "media",
          contentType,
          body: fs.createReadStream(file.filepath),
        });

        await fsPromises.unlink(file.filepath).catch(() => undefined);

        return this.created(res, upload, "Media uploaded successfully");
      } catch (uploadError) {
        return next(uploadError);
      }
    });
  };

  listPosts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { pageId } = req.params as { pageId: string };
      const { status } = req.query as { status?: string };
      const posts = await publishingService.listPosts(pageId, status);
      return this.ok(res, posts, "Publishing posts retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  updatePost = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId } = req.params as { postId: string };
      const body = req.body as { message?: string; scheduledPublishTime?: string; scheduled_publish_time?: string };
      const post = await publishingService.updatePost(postId, {
        message: body.message,
        scheduledPublishTime: body.scheduledPublishTime || body.scheduled_publish_time,
      });
      return this.ok(res, post, "Post updated successfully");
    } catch (error) {
      return next(error);
    }
  };

  retryPost = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId } = req.params as { postId: string };
      const post = await publishingService.retryPost(postId);
      return this.ok(res, post, "Post retry submitted successfully");
    } catch (error) {
      return next(error);
    }
  };

  deletePost = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId } = req.params as { postId: string };
      const post = await publishingService.deletePost(postId);
      return this.ok(res, post, "Post deleted successfully");
    } catch (error) {
      return next(error);
    }
  };
}

export default new PublishingController();
