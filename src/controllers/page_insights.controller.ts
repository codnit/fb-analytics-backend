import type { NextFunction, Request, Response } from "express";
import { BaseController } from "../core/base.controller";
import pageInsightsService from "../services/page/page_insights.service";
import connectedPageRepository from "../repositories/ConnectedPage";
import earningsRepository from "../repositories/Earnings";
import { ResponseFormatter } from "../utils/formatter";
import { isUuid } from "../utils/uuid";

export class PageInsightsController extends BaseController {
  getPageInsights = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { fbPageId, since: pSince, until: pUntil } = req.params as Record<string, string>;
      const { since: qSince, until: qUntil } = req.query as Record<string, string>;
      const since = pSince || qSince;
      const until = pUntil || qUntil;

      let realFbPageId = fbPageId;
      if (isUuid(fbPageId)) {
        const page = await connectedPageRepository.getPageById(fbPageId);
        if (page) {
          realFbPageId = page.fb_page_id;
        }
      }

      const insights = await pageInsightsService.getPageInsights(realFbPageId, { since, until });

      if (since && until) {
        await pageInsightsService.ensurePageEarnings(realFbPageId, since, until);
      }

      // Merge earnings
      const earnings = since && until
        ? await earningsRepository.getPageEarningsForPerformanceRange(realFbPageId, since, until)
        : await earningsRepository.getPageEarnings(realFbPageId);
      const syntheticEarnings: any[] = [];
      for (const e of earnings) {
        syntheticEarnings.push({
          page_id: realFbPageId,
          metric_name: "content_monetization_earnings",
          metric_value: { value: e.earnings_amount },
          period: e.period || "day",
          end_time: e.end_time,
        });
        syntheticEarnings.push({
          page_id: realFbPageId,
          metric_name: "monetization_approximate_earnings",
          metric_value: { value: e.approximate_earnings },
          period: e.period || "day",
          end_time: e.end_time,
        });
        syntheticEarnings.push({
          page_id: realFbPageId,
          metric_name: "content_type_breakdown",
          metric_value: e.content_type_breakdown ?? null,
          period: e.period || "day",
          end_time: e.end_time,
        });
      }

      const allInsights = [...(insights || []), ...syntheticEarnings];

      const formattedInsights = ResponseFormatter.formatPageInsights(fbPageId, allInsights as never);
      return this.ok(res, { data: formattedInsights }, "Page insights retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  getPageMetrics = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { fbPageId, metricName, since: pSince, until: pUntil } = req.params as Record<string, string>;
      const { since: qSince, until: qUntil } = req.query as Record<string, string>;
      const since = pSince || qSince;
      const until = pUntil || qUntil;

      let realFbPageId = fbPageId;
      if (isUuid(fbPageId)) {
        const page = await connectedPageRepository.getPageById(fbPageId);
        if (page) {
          realFbPageId = page.fb_page_id;
        }
      }

      const metrics = await pageInsightsService.getPageMetrics(realFbPageId, metricName, { since, until });

      if (!metrics || metrics.length === 0) {
        return this.notFound(res, "Page metrics not found");
      }

      const formattedMetrics = ResponseFormatter.formatPageInsights(fbPageId, metrics as never);
      return this.ok(res, formattedMetrics, "Page metrics retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  getMultiplePageInsights = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { since: pSince, until: pUntil } = req.params as Record<string, string>;
      const { since: qSince, until: qUntil } = req.query as Record<string, string>;
      const since = pSince || qSince;
      const until = pUntil || qUntil;
      const pageIds = (req.body?.pageIds || req.query?.pageIds) as string[];

      if (!pageIds || !Array.isArray(pageIds)) {
        return this.badRequest(res, "pageIds array is required");
      }

      const realPageIds = await Promise.all(
        pageIds.map(async (id) => {
          if (isUuid(id)) {
            const page = await connectedPageRepository.getPageById(id);
            return page?.fb_page_id || id;
          }
          return id;
        })
      );

      if (since && until) {
        await Promise.all(
          realPageIds.map((pageId) => pageInsightsService.ensurePageEarnings(pageId, since, until))
        );
      }

      const allEarnings = since && until
        ? await earningsRepository.getPageEarningsByPageIdsAndPerformanceRange(realPageIds, since, until)
        : await earningsRepository.getPageEarningsByPageIdsAndRange(realPageIds, new Date(0), new Date());

      const earningsByPage = new Map<string, any[]>();
      for (const e of allEarnings) {
        if (!earningsByPage.has(e.page_id)) earningsByPage.set(e.page_id, []);
        earningsByPage.get(e.page_id)?.push({
          page_id: e.page_id,
          metric_name: "content_monetization_earnings",
          metric_value: { value: e.earnings_amount },
          period: e.period || "day",
          end_time: e.end_time,
        });
        earningsByPage.get(e.page_id)?.push({
          page_id: e.page_id,
          metric_name: "monetization_approximate_earnings",
          metric_value: { value: e.approximate_earnings },
          period: e.period || "day",
          end_time: e.end_time,
        });
        earningsByPage.get(e.page_id)?.push({
          page_id: e.page_id,
          metric_name: "content_type_breakdown",
          metric_value: e.content_type_breakdown ?? null,
          period: e.period || "day",
          end_time: e.end_time,
        });
      }

      const results = await Promise.all(
        pageIds.map(async (pageId, index) => {
          try {
            const realFbPageId = realPageIds[index];
            const insights = await pageInsightsService.getPageInsights(realFbPageId, { since, until });
            const pageEarnings = earningsByPage.get(realFbPageId) || [];
            const merged = [...(insights || []), ...pageEarnings];

            return {
              success: true,
              pageId,
              data: ResponseFormatter.formatPageInsights(pageId, merged as never),
            };
          } catch (error) {
            return {
              success: false,
              pageId,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      return this.ok(res, results, "Multiple page insights retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  createPageInsight = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { fbPageId } = req.params as Record<string, string>;
      const insightData = req.body as Record<string, unknown>;
      const insight = await pageInsightsService.createPageInsight(insightData as never);
      const formattedInsight = ResponseFormatter.formatPageInsights(fbPageId || (insightData.page_id as string), [insight as never]);
      return this.created(res, formattedInsight, "Page insight created successfully");
    } catch (error) {
      return next(error);
    }
  };
  exportPageReport = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { fbPageId, since: pSince, until: pUntil } = req.params as Record<string, string>;
      const { since: qSince, until: qUntil } = req.query as Record<string, string>;
      const since = pSince || qSince;
      const until = pUntil || qUntil;

      let realFbPageId = fbPageId;
      if (isUuid(fbPageId)) {
        const page = await connectedPageRepository.getPageById(fbPageId);
        if (page) {
          realFbPageId = page.fb_page_id;
        }
      }

      // Re-use logic from getPageInsights to get all data
      const insights = await pageInsightsService.getPageInsights(realFbPageId, { since, until });

      if (since && until) {
        await pageInsightsService.ensurePageEarnings(realFbPageId, since, until);
      }

      const earnings = since && until
        ? await earningsRepository.getPageEarningsForPerformanceRange(realFbPageId, since, until)
        : await earningsRepository.getPageEarnings(realFbPageId);
      const syntheticEarnings: any[] = [];
      for (const e of earnings) {
        syntheticEarnings.push({
          page_id: realFbPageId,
          metric_name: "content_monetization_earnings",
          metric_value: { value: e.earnings_amount },
          period: e.period || "day",
          end_time: e.end_time,
        });
        syntheticEarnings.push({
          page_id: realFbPageId,
          metric_name: "content_type_breakdown",
          metric_value: e.content_type_breakdown ?? null,
          period: e.period || "day",
          end_time: e.end_time,
        });
      }

      const allInsights = [...(insights || []), ...syntheticEarnings];

      // Delay importing ReportService to avoid circular dependency issues at boot if any
      const { default: reportService } = await import("../services/report.service");
      
      const fileUrl = await reportService.generateAndUploadPageReport(realFbPageId, since, until, allInsights);

      return this.ok(res, { url: fileUrl }, "Report exported successfully");
    } catch (error) {
      return next(error);
    }
  };
}

export default new PageInsightsController();
