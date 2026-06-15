import type { NextFunction, Request, Response } from "express";
import { BaseController } from "../core/base.controller";
import postInsightsService from "../services/post/post_insights.service";
import postRepository from "../repositories/Post";
import earningsRepository from "../repositories/Earnings";
import { ResponseFormatter } from "../utils/formatter";
import { isUuid } from "../utils/uuid";
import postSyncService from "../services/facebook/post.sync.service";
import { resolveInsightCache, resolveStoredToken } from "../utils/insight-cache.helpers";
import { DEFAULT_POST_METRICS } from "../services/facebookSync.presets";
import connectedPageRepository from "../repositories/ConnectedPage";
import postInsightsRepository from "../repositories/PostInsights";
import { PostInsightEntity } from "../types/domain";

export class PostInsightsController extends BaseController {
  getPostInsights = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId, since: pSince, until: pUntil } = req.params as Record<string, string>;
      const { since: qSince, until: qUntil } = req.query as Record<string, string>;
      const since = pSince || qSince;
      const until = pUntil || qUntil;

      let fbPostId = postId;
      // If the ID is a UUID, it's likely an internal ID, we need to resolve the fb_post_id
      if (isUuid(postId)) {
        const post = await postRepository.getPostById(postId);
        if (post) {
          fbPostId = post.fb_post_id;
        }
      }

      const insights = await postInsightsService.getPostInsights(fbPostId, { since, until });

      // Merge earnings
      const earnings = await earningsRepository.getPostEarnings(fbPostId);
      const syntheticEarnings: any[] = [];
      for (const e of earnings) {
        syntheticEarnings.push({
          post_id: fbPostId,
          metric_name: "content_monetization_earnings",
          metric_value: { value: e.earnings_amount },
          period: e.period || "lifetime",
          end_time: e.end_time,
        });
        syntheticEarnings.push({
          post_id: fbPostId,
          metric_name: "monetization_approximate_earnings",
          metric_value: { value: e.approximate_earnings },
          period: e.period || "lifetime",
          end_time: e.end_time,
        });
      }

      const allInsights = [...(insights || []), ...syntheticEarnings];

      const formattedInsights = ResponseFormatter.formatPostInsights(fbPostId, allInsights as never);
      return this.ok(res, { data: formattedInsights }, "Post insights retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  getPostMetrics = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId, metricName, since: pSince, until: pUntil } = req.params as Record<string, string>;
      const { since: qSince, until: qUntil } = req.query as Record<string, string>;
      const since = pSince || qSince;
      const until = pUntil || qUntil;

      let fbPostId = postId;
      if (isUuid(postId)) {
        const post = await postRepository.getPostById(postId);
        if (post) {
          fbPostId = post.fb_post_id;
        }
      }

      const metrics = await postInsightsService.getPostMetrics(fbPostId, metricName, { since, until });

      if (!metrics || metrics.length === 0) {
        return this.notFound(res, "Post metrics not found");
      }

      const formattedMetrics = ResponseFormatter.formatPostInsights(fbPostId, metrics as never);
      return this.ok(res, formattedMetrics, "Post metrics retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };


  // 
  // getMultiplePostInsights = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  //   try {
  //     const { since: pSince, until: pUntil } = req.params as Record<string, string>;
  //     const { since: qSince, until: qUntil } = req.query as Record<string, string>;
  //     const since = pSince || qSince;
  //     const until = pUntil || qUntil;
  //     const postIds = (req.body?.postIds || req.query?.postIds) as string[];

  //     if (!postIds || !Array.isArray(postIds)) {
  //       return this.badRequest(res, "postIds array is required");
  //     }

  //     const realPostIds = await Promise.all(
  //       postIds.map(async (id) => {
  //         if (isUuid(id)) {
  //           const post = await postRepository.getPostById(id);
  //           return post?.fb_post_id || id;
  //         }
  //         return id;
  //       })
  //     );

  //     const allEarnings = await earningsRepository.getPostEarningsByPostIdsAndRange(
  //       realPostIds,
  //       since ? new Date(since) : new Date(0),
  //       until ? new Date(until) : new Date()
  //     );

  //     const earningsByPost = new Map<string, any[]>();
  //     for (const e of allEarnings) {
  //       if (!earningsByPost.has(e.post_id)) earningsByPost.set(e.post_id, []);
  //       earningsByPost.get(e.post_id)?.push({
  //         post_id: e.post_id,
  //         metric_name: "content_monetization_earnings",
  //         metric_value: { value: e.earnings_amount },
  //         period: e.period || "lifetime",
  //         end_time: e.end_time,
  //       });
  //       earningsByPost.get(e.post_id)?.push({
  //         post_id: e.post_id,
  //         metric_name: "monetization_approximate_earnings",
  //         metric_value: { value: e.approximate_earnings },
  //         period: e.period || "lifetime",
  //         end_time: e.end_time,
  //       });
  //     }

  //     const results = await Promise.all(
  //       postIds.map(async (postId, index) => {
  //         try {
  //           const fbPostId = realPostIds[index];
  //           const insights = await postInsightsService.getPostInsights(fbPostId, { since, until });
  //           const postEarnings = earningsByPost.get(fbPostId) || [];
  //           const merged = [...(insights || []), ...postEarnings];

  //           return {
  //             success: true,
  //             postId,
  //             data: ResponseFormatter.formatPostInsights(postId, merged as never),
  //           };
  //         } catch (error) {
  //           return {
  //             success: false,
  //             postId,
  //             error: error instanceof Error ? error.message : String(error),
  //           };
  //         }
  //       })
  //     );

  //     return this.ok(res, results, "Multiple post insights retrieved successfully");
  //   } catch (error) {
  //     return next(error);
  //   }
  // };
  // 

  getMultiplePostInsights = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { since: pSince, until: pUntil } = req.params as Record<string, string>;
      const { since: qSince, until: qUntil } = req.query as Record<string, string>;
      const since = pSince || qSince;
      const until = pUntil || qUntil;
      const postIds = (req.body?.postIds || req.query?.postIds) as string[];

      if (!postIds || !Array.isArray(postIds)) {
        return this.badRequest(res, "postIds array is required");
      }

      // Batch UUID resolution
      const uuidIds = postIds.filter(isUuid);
      const uuidPosts = uuidIds.length > 0 ? await postRepository.getPostsByIds(uuidIds) : [];
      const uuidToFbId = new Map(uuidPosts.map((p) => [p.id, p.fb_post_id]));
      const realPostIds = postIds.map((id) => (isUuid(id) ? uuidToFbId.get(id) || id : id));

      // Earnings
      const allEarnings = await earningsRepository.getPostEarningsByPostIdsAndRange(
        realPostIds,
        since ? new Date(since) : new Date(0),
        until ? new Date(until) : new Date()
      );

      const earningsByPost = new Map<string, any[]>();
      for (const e of allEarnings) {
        if (!earningsByPost.has(e.post_id)) earningsByPost.set(e.post_id, []);
        earningsByPost.get(e.post_id)?.push({
          post_id: e.post_id,
          metric_name: "content_monetization_earnings",
          metric_value: { value: e.earnings_amount },
          period: e.period || "lifetime",
          end_time: e.end_time,
        });
        earningsByPost.get(e.post_id)?.push({
          post_id: e.post_id,
          metric_name: "monetization_approximate_earnings",
          metric_value: { value: e.approximate_earnings },
          period: e.period || "lifetime",
          end_time: e.end_time,
        });
      }

      // DB-only read — no FB API calls
      const dbOptions = {
        since: since ? new Date(since).toISOString() : undefined,
        until: until ? new Date(until).toISOString() : undefined,
      };

      const results = await Promise.all(
        postIds.map(async (postId, index) => {
          const fbPostId = realPostIds[index];
          try {
            const insights = await postInsightsRepository.getPostInsights(fbPostId, dbOptions);
            const postEarnings = earningsByPost.get(fbPostId) || [];
            const merged = [...(insights || []), ...postEarnings];

            return {
              success: true,
              postId,
              data: ResponseFormatter.formatPostInsights(postId, merged as never),
            };
          } catch (error) {
            return {
              success: false,
              postId,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      // Background sync for posts with no insights data
      const postsWithNoData = results
        .filter(r => r.success && (!r.data || r.data.length === 0))
        .map((r, i) => realPostIds[postIds.indexOf(r.postId)]);

      if (postsWithNoData.length > 0) {
        console.log(`🔄 Background sync queued for ${postsWithNoData.length} posts`);
        // Fire and forget via your existing BullMQ queue
        // syncQueue.add('sync-post-insights', { postIds: postsWithNoData, since, until });
      }

      return this.ok(res, results, "Multiple post insights retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  createPostInsight = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const insightData = req.body as Record<string, unknown>;
      const insight = await postInsightsService.createPostInsight(insightData as never);
      const formattedInsight = ResponseFormatter.formatPostInsights(insightData.post_id as string, [insight as never]);
      return this.created(res, formattedInsight, "Post insight created successfully");
    } catch (error) {
      return next(error);
    }
  };
}

export default new PostInsightsController();
