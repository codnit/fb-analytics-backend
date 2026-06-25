import type { NextFunction, Request, Response } from "express";
import { BaseController } from "../core/base.controller";
import pageService from "../services/page/page.service";
import { ResponseFormatter } from "../utils/formatter";

export class PageController extends BaseController {
  getPageById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { pageId } = req.params as Record<string, string>;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pageId);
      const page = isUuid
        ? await pageService.getPageById(pageId)
        : await pageService.getPageByFbPageId(pageId);

      if (!page) {
        return this.notFound(res, "Page not found");
      }

      const formattedPage = ResponseFormatter.formatConnectedPage(page.partner_id, page as never);
      return this.ok(res, formattedPage, "Page retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  getPartnerPages = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { partnerId } = req.params as Record<string, string>;
      const pages = await pageService.getPartnerPages(partnerId);
      const formattedPages = pages.map((page) => ResponseFormatter.formatConnectedPage(partnerId, page as never));
      return this.ok(res, formattedPages, "Pages retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  createPage = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const pageData = req.body as Record<string, unknown>;
      const page = await pageService.createConnectedPage(pageData as never);
      const formattedPage = ResponseFormatter.formatConnectedPage(page.partner_id, page as never);
      return this.created(res, formattedPage, "Page created successfully");
    } catch (error) {
      return next(error);
    }
  };

  getAllPages = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const pages = await pageService.getAllPages();
      const formattedPages = pages.map((page) => ResponseFormatter.formatConnectedPage(page.partner_id, page as never));
      return this.ok(res, formattedPages, "All pages retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };
}

export default new PageController();
