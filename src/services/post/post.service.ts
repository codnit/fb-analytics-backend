import { BaseService } from "../../core/base.service";
import connectedPageRepository from "../../repositories/ConnectedPage";
import postRepository from "../../repositories/Post";
import type { GraphQueryOptions, PostCreateInput, PostEntity } from "../../types/domain";
import type { FacebookPost } from "../../types/facebook";
import insightsService from "../insights.service";
import postSyncService from "../facebook/post.sync.service";
import { DEFAULT_POST_FETCH_LIMIT } from "../facebookSync.presets";
import { pagePostsSyncQueue, postMetadataSyncQueue } from "../../queues/syncQueue";
import {
  getCoverageBounds,
  getMissingWindows,
  resolveStoredToken,
  toDate,
} from "../../utils/insight-cache.helpers";

const normalizeWindowBoundary = (value: string | undefined, boundary: "since" | "until"): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}${boundary === "since" ? "T00:00:00.000Z" : "T23:59:59.999Z"}`;
  }

  return value;
};

const POST_METADATA_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class PostService extends BaseService {
  constructor() {
    super("PostService");
  }

  async isFullySynced(pageId: string, since?: Date | null, until?: Date | null): Promise<boolean> {
    const jobs = await pagePostsSyncQueue.getJobs(["waiting", "active", "delayed"]);
    const hasPendingJobForPage = jobs.some((job) => job.data?.pageId === pageId);
    return !hasPendingJobForPage;
  }

  createPost(postData: PostCreateInput): Promise<PostEntity> {
    return postRepository.createPost(postData);
  }

  getPostById(postId: string): Promise<PostEntity | null> {
    return postRepository.getPostById(postId);
  }

  private async queueStaleVisiblePostMetadataRefresh(pageId: string, posts: PostEntity[]): Promise<void> {
    const refreshBefore = Date.now() - POST_METADATA_REFRESH_INTERVAL_MS;
    const stalePosts = posts.filter((post) => {
      const syncedAt = post.synced_at ? new Date(post.synced_at).getTime() : 0;
      return Boolean(post.fb_post_id) && (!syncedAt || syncedAt < refreshBefore);
    });

    if (stalePosts.length === 0) {
      return;
    }

    await Promise.all(
      stalePosts.map((post) =>
        postMetadataSyncQueue.add(
          "sync-post-metadata",
          { pageId, fbPostId: post.fb_post_id },
          {
            jobId: `post-meta-${post.fb_post_id}`,
            removeOnComplete: true,
            removeOnFail: true,
          }
        )
      )
    ).catch((err) => console.error("Failed to queue post metadata refresh:", err));
  }

  // async getPagePosts(
  //   pageId: string,
  //   options: Pick<GraphQueryOptions, "since" | "until"> = {}
  // ): Promise<PostEntity[]> {
  //   const normalizedSince = normalizeWindowBoundary(options.since, "since");
  //   const normalizedUntil = normalizeWindowBoundary(options.until, "until");
  //   const requestedSince = toDate(normalizedSince);
  //   const requestedUntil = toDate(normalizedUntil);

  //   if (!requestedSince || !requestedUntil) {
  //     return postRepository.getPagePosts(pageId, {
  //       since: normalizedSince,
  //       until: normalizedUntil,
  //     });
  //   }

  //   const dbOptions = {
  //     since: normalizedSince || requestedSince.toISOString(),
  //     until: normalizedUntil || requestedUntil.toISOString(),
  //   };

  //   const existing = await postRepository.getPagePosts(pageId, dbOptions);
  //   const coverage = getCoverageBounds(existing.map((post) => ({ end_time: post.created_time ?? null })));
  //   const missingWindows = getMissingWindows(requestedSince, requestedUntil, coverage);

  //   if (missingWindows.length === 0) {
  //     return existing;
  //   }

  //   const connectedPage = await connectedPageRepository.getPageByFbPageId(pageId);
  //   const accessToken = resolveStoredToken(connectedPage?.page_token_encrypted);

  //   if (!accessToken) {
  //     throw new Error(`No stored token found for page ${pageId}`);
  //   }

  //   for (const window of missingWindows) {
  //     const response = await insightsService.getPagePosts(pageId, {
  //       access_token: accessToken,
  //       since: window.since,
  //       until: window.until,
  //       limit: DEFAULT_POST_FETCH_LIMIT,
  //       fetchAll: true,
  //     });

  //     for (const post of response.data as FacebookPost[]) {
  //       if (!post?.id) {
  //         continue;
  //       }

  //       await postSyncService.syncPost({
  //         page_id: pageId,
  //         fb_post_id: post.id,
  //         message: post.message,
  //         type: post.status_type,
  //         full_picture: post.full_picture || null,
  //         comments_count: post.comments?.summary?.total_count || 0,
  //         shares_count: post.shares?.count || 0,
  //         permalink: post.permalink_url,
  //         created_time: post.created_time,
  //       });
  //     }
  //   }

  //   return postRepository.getPagePosts(pageId, dbOptions);
  // }

  // VERSION 1
  // getPagePosts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  //   try {
  //     const { pageId } = req.params as Record<string, string>;
  //     const { since, until } = req.query as Record<string, string>;

  //     let realPageId = pageId;
  //     if (isUuid(pageId)) {
  //       const page = await connectedPageRepository.getPageById(pageId);
  //       if (page) realPageId = page.fb_page_id;
  //     }

  //     const { posts, syncStatus } = await postService.getPagePosts(realPageId, { since, until });

  //     console.log(`[PostController] Found ${posts.length} posts for page ${realPageId} (${syncStatus})`);

  //     const formattedPosts = posts.map((post) => ResponseFormatter.formatPost(realPageId, post as never));

  //     return this.ok(res, { posts: formattedPosts, syncStatus }, "Posts retrieved successfully");
  //   } catch (error) {
  //     console.error(`[PostController] Error getting posts for page ${req.params.pageId}:`, error);
  //     return next(error);
  //   }
  // };
  // postService
  // async getPagePosts(
  //   pageId: string,
  //   options: Pick<GraphQueryOptions, "since" | "until"> = {}
  // ): Promise<{ posts: PostEntity[]; syncStatus: "ready" | "pending" }> {
  //   const normalizedSince = normalizeWindowBoundary(options.since, "since");
  //   const normalizedUntil = normalizeWindowBoundary(options.until, "until");
  //   const requestedSince = toDate(normalizedSince);
  //   const requestedUntil = toDate(normalizedUntil);

  //   const dbOptions = {
  //     since: normalizedSince,
  //     until: normalizedUntil,
  //   };

  //   // Always return DB data immediately
  //   const existing = await postRepository.getPagePosts(pageId, dbOptions);

  //   if (!requestedSince || !requestedUntil) {
  //     return { posts: existing, syncStatus: "ready" };
  //   }

  //   const coverage = getCoverageBounds(existing.map((post) => ({ end_time: post.created_time ?? null })));
  //   const missingWindows = getMissingWindows(requestedSince, requestedUntil, coverage);

  //   if (missingWindows.length === 0) {
  //     return { posts: existing, syncStatus: "ready" };
  //   }

  //   // Fire and forget — don't await
  //   pagePostsSyncQueue.add(
  //     "sync-page-posts",
  //     { pageId, missingWindows },
  //     {
  //       attempts: 3,
  //       backoff: { type: "exponential", delay: 2000 },
  //       removeOnComplete: true,
  //     }
  //   ).catch(err => console.error("Failed to queue page post sync:", err));

  //   return { posts: existing, syncStatus: "pending" };
  // }


  // async getPagePosts(
  //   pageId: string,
  //   options: Pick<GraphQueryOptions, "since" | "until"> & { page: number; limit: number }
  // ): Promise<{ posts: PostEntity[]; syncStatus: "ready" | "pending"; total: number }> {
  //   const normalizedSince = normalizeWindowBoundary(options.since, "since");
  //   const normalizedUntil = normalizeWindowBoundary(options.until, "until");
  //   const requestedSince = toDate(normalizedSince);
  //   const requestedUntil = toDate(normalizedUntil);

  //   const dbOptions = {
  //     since: normalizedSince,
  //     until: normalizedUntil,
  //   };

  //   // Kick off background sync for the FULL range — fire once, doesn't block pagination
  //   if (requestedSince && requestedUntil) {
  //     const allExistingForCoverage = await postRepository.getPagePosts(pageId, dbOptions); // or a lighter "get just timestamps" query
  //     const coverage = getCoverageBounds(allExistingForCoverage.map((post) => ({ end_time: post.created_time ?? null })));
  //     const missingWindows = getMissingWindows(requestedSince, requestedUntil, coverage);

  //     if (missingWindows.length > 0) {
  //       pagePostsSyncQueue.add(
  //         "sync-page-posts",
  //         { pageId, missingWindows },
  //         { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true }
  //       ).catch(err => console.error("Failed to queue page post sync:", err));
  //     }
  //   }

  //   // ALWAYS serve this page straight from DB, whatever's there right now
  //   const { posts, total } = await postRepository.getPagePostsPaginated(pageId, dbOptions, options.page, options.limit);

  //   // syncStatus just tells frontend "background work is happening" — doesn't block this page's data
  //   const syncStatus = await this.isFullySynced(pageId, requestedSince, requestedUntil) ? "ready" : "pending";

  //   return { posts, syncStatus, total };
  // }

  // async getPagePosts(
  //   pageId: string,
  //   options: Pick<GraphQueryOptions, "since" | "until"> & { page: number; limit: number }
  // ): Promise<{ posts: PostEntity[]; syncStatus: "ready" | "pending"; total: number }> {
  //   const normalizedSince = normalizeWindowBoundary(options.since, "since");
  //   const normalizedUntil = normalizeWindowBoundary(options.until, "until");
  //   const requestedSince = toDate(normalizedSince);
  //   const requestedUntil = toDate(normalizedUntil);

  //   const dbOptions = { since: normalizedSince, until: normalizedUntil };

  //   let missingWindows: { since: string; until: string }[] = [];

  //   if (options.page === 1 && requestedSince && requestedUntil) {
  //     const allExistingForCoverage = await postRepository.getPagePosts(pageId, dbOptions);
  //     const coverage = getCoverageBounds(allExistingForCoverage.map((post) => ({ end_time: post.created_time ?? null })));
  //     missingWindows = getMissingWindows(requestedSince, requestedUntil, coverage);

  //     const sanitize = (iso: string) => iso.replace(/[:.]/g, "-");

  //     if (missingWindows.length > 0) {
  //       await Promise.all(
  //         missingWindows.map((window) =>
  //           pagePostsSyncQueue.add(
  //             "sync-page-posts",
  //             { pageId, missingWindows: [window] },
  //             {
  //               attempts: 3,
  //               backoff: { type: "exponential", delay: 2000 },
  //               removeOnComplete: false,
  //               jobId: `sync-${pageId}-${sanitize(window.since)}-${sanitize(window.until)}`,
  //             }
  //           )
  //         )
  //       ).catch((err) => console.error("Failed to queue page post sync:", err));
  //     }
  //   }

  //   const { posts, total } = await postRepository.getPagePostsPaginated(pageId, dbOptions, options.page, options.limit);

  //   const syncStatus = missingWindows.length > 0 ? "pending" : "ready";

  //   return { posts, syncStatus, total };
  // }

  async getPagePosts(
    pageId: string,
    options: Pick<GraphQueryOptions, "since" | "until"> & { page: number; limit: number }
  ): Promise<{ posts: PostEntity[]; syncStatus: "ready" | "pending"; total: number }> {
    const normalizedSince = normalizeWindowBoundary(options.since, "since");
    const normalizedUntil = normalizeWindowBoundary(options.until, "until");
    const requestedSince = toDate(normalizedSince);
    const requestedUntil = toDate(normalizedUntil);

    const dbOptions = { since: normalizedSince, until: normalizedUntil };

    let missingWindows: { since: string; until: string }[] = [];

    if (options.page === 1 && requestedSince && requestedUntil) {
      // First check if we have ANY data for this time period
      const { total: existingCount } = await postRepository.getPagePostsPaginated(pageId, dbOptions, 1, 1);

      // Only check for missing windows if we don't have any data at all
      if (existingCount === 0) {
        const allExistingForCoverage = await postRepository.getPagePosts(pageId, dbOptions);
        const coverage = getCoverageBounds(allExistingForCoverage.map((post) => ({ end_time: post.created_time ?? null })));
        missingWindows = getMissingWindows(requestedSince, requestedUntil, coverage);

        const sanitize = (iso: string) => iso.replace(/[:.]/g, "-");

        if (missingWindows.length > 0) {
          await Promise.all(
            missingWindows.map((window) =>
              pagePostsSyncQueue.add(
                "sync-page-posts",
                { pageId, missingWindows: [window] },
                {
                  attempts: 3,
                  backoff: { type: "exponential", delay: 2000 },
                  removeOnComplete: false,
                  jobId: `sync-${pageId}-${sanitize(window.since)}-${sanitize(window.until)}`,
                }
              )
            )
          ).catch((err) => console.error("Failed to queue page post sync:", err));
        }
      }
    }

    const { posts, total } = await postRepository.getPagePostsPaginated(pageId, dbOptions, options.page, options.limit);
    void this.queueStaleVisiblePostMetadataRefresh(pageId, posts);

    const syncStatus = missingWindows.length > 0 ? "pending" : "ready";

    return { posts, syncStatus, total };
  }

}

export default new PostService();
