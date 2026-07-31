import { BaseService } from "../../core/base.service";
import postRepository from "../../repositories/Post";
import insightsService from "../insights.service";
import { facebookSyncQueue } from "../../queues/facebookSync.queue";
import type {
  InitialConnectionSyncResult,
  PageSyncJobPayload,
  PageSyncJobResult,
  PostSyncJobPayload,
  PostSyncJobResult,
} from "../../types/facebookSync";
import type { SyncJobEntity } from "../../types/domain";
import type { FacebookPage, FacebookPost } from "../../types/facebook";
import partnerSyncService from "./partner.sync.service";
import pageSyncService from "./page.sync.service";
import postSyncService from "./post.sync.service";
import syncJobService from "./sync-job.service";
import {
  DEFAULT_PAGE_METRICS,
  DEFAULT_POST_FETCH_LIMIT,
  DEFAULT_POST_METRICS,
  DEFAULT_POST_WRITE_CHUNK,
  DEFAULT_SYNC_WINDOW_DAYS,
} from "../facebookSync.presets";
import { mapLimit } from "../../utils/pLimits";
import connectedPageRepository from "../../repositories/ConnectedPage";
import { isFacebookTokenError } from "../../utils/facebookAuthError";

const normalizeGrantedScopes = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((scope) => String(scope).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((scope) => scope.trim()).filter(Boolean);
  }

  return [];
};

export class FacebookSyncOrchestrator extends BaseService {
  constructor() {
    super("FacebookSyncOrchestrator");
  }

  async initialConnectionSync(
    accessToken: string,
    registrationData?: any,
    partnerId?: string
  ): Promise<InitialConnectionSyncResult> {
    return this.run("initialConnectionSync", async () => {
      const partner = await partnerSyncService.syncPartner(accessToken, registrationData, partnerId);
      const facebookValidationStartedAt = new Date();
      const pagesResponse = await insightsService.getUserPages({ access_token: accessToken });
      const enablePublishing = registrationData?.enablePublishing === true;
      const publishingOnly = enablePublishing && registrationData?.publishingOnly === true;
      const grantedScopes = normalizeGrantedScopes(registrationData?.facebookGrantedScopes || registrationData?.grantedScopes);
      const queuedPages: InitialConnectionSyncResult["queuedPages"] = [];
      const errors: InitialConnectionSyncResult["errors"] = [];

      await Promise.all(
        (pagesResponse.data as FacebookPage[]).map(async (fbPage) => {
          if (!fbPage?.id) return;
          try {
            await connectedPageRepository.clearFacebookReauthRequiredByFbPageId(
              fbPage.id,
              partner.id,
              facebookValidationStartedAt
            );

            if (enablePublishing) {
              await pageSyncService.syncPage({
                partner_id: partner.id,
                fb_page_id: fbPage.id,
                page_name: fbPage.name || null,
                page_token_encrypted: fbPage.access_token || null,
                fan_count: fbPage.fan_count || 0,
                category: fbPage.category || null,
                picture_url: fbPage.picture?.data?.url || null,
                publishing_enabled: true,
                publishing_granted_at: new Date(),
                publishing_granted_by: partner.id,
                granted_scopes: grantedScopes,
                is_active: true,
                last_synced_at: new Date(),
              });
            }

            if (publishingOnly) {
              return;
            }

            const job = await facebookSyncQueue.enqueuePageSync({
              partnerId: partner.id,
              accessToken,
              facebookPage: fbPage,
              syncWindowDays: DEFAULT_SYNC_WINDOW_DAYS,
              postBatchSize: DEFAULT_POST_FETCH_LIMIT,
              postWriteChunkSize: DEFAULT_POST_WRITE_CHUNK,
              pageMetrics: DEFAULT_PAGE_METRICS,
              postMetrics: DEFAULT_POST_METRICS,
              enablePublishing,
              publishingGrantedBy: enablePublishing ? partner.id : null,
              grantedScopes,
            });
            queuedPages.push({
              fbPageId: fbPage.id,
              pageName: fbPage.name || null,
              jobId: job.id ? String(job.id) : null,
            });
          } catch (error) {
            errors.push({
              pageId: fbPage.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
      );

      return { partner, pagesQueued: queuedPages.length, queuedPages, errors };
    });
  }

  async processPageSyncJob(payload: PageSyncJobPayload): Promise<PageSyncJobResult> {
    return this.run("processPageSyncJob", async () => {
      const fbPage = payload.facebookPage;
      const accessToken = fbPage.access_token || payload.accessToken;
      const syncUntil = new Date().toISOString();
      const since = this.getWindowStart(payload.syncWindowDays ?? DEFAULT_SYNC_WINDOW_DAYS);
      const syncStartedAt = new Date();
      let syncJob: SyncJobEntity | null = null;

      console.log(`[facebook-sync] 🚀 Starting sync for page: ${fbPage.name || fbPage.id}`);

      try {
        const syncedPage = await pageSyncService.syncPage({
          partner_id: payload.partnerId,
          fb_page_id: fbPage.id,
          page_name: fbPage.name || null,
          page_token_encrypted: fbPage.access_token || null,
          fan_count: fbPage.fan_count || 0,
          category: fbPage.category || null,
          picture_url: fbPage.picture?.data?.url || null,
          publishing_enabled: payload.enablePublishing ? true : undefined,
          publishing_granted_at: payload.enablePublishing ? new Date() : undefined,
          publishing_granted_by: payload.enablePublishing ? payload.publishingGrantedBy || payload.partnerId : undefined,
          granted_scopes: payload.grantedScopes,
          is_active: true,
          last_synced_at: new Date(),
        });

        syncJob = await syncJobService.createSyncJob(syncedPage.id, "page_sync");
        await syncJobService.updateSyncJob(syncJob.id, "running");

        // Kick off page insights + page earnings + the post pagination loop
        // in parallel. They share no state.
        const pageInsightsPromise = pageSyncService.syncPageInsights({
          pageId: syncedPage.id,
          facebookPageId: fbPage.id,
          accessToken,
          metrics: payload.pageMetrics || DEFAULT_PAGE_METRICS,
          period: "day",
          since,
          until: syncUntil,
        });

        const postsCollected: FacebookPost[] = [];
        const allPostJobs: PostSyncJobPayload[] = [];
        let nextPageUrl: string | undefined;
        let pageNum = 1;
        const writeChunkSize = payload.postWriteChunkSize ?? DEFAULT_POST_WRITE_CHUNK;

        do {
          const postsPage = await insightsService.getPagePostsPage(fbPage.id, {
            access_token: accessToken,
            limit: payload.postBatchSize ?? DEFAULT_POST_FETCH_LIMIT,
            since,
            until: syncUntil,
            nextPageUrl,
          });

          const fbPosts = postsPage.data.filter((p): p is FacebookPost => Boolean(p?.id));
          postsCollected.push(...fbPosts);
          console.log(`[facebook-sync] 🔄 batch ${pageNum}: ${fbPosts.length} posts`);

          // Parallel upsert with bounded concurrency instead of awaiting one
          // post at a time. Big win on N posts.
          const syncedPosts = await mapLimit(fbPosts, writeChunkSize, (fbPost) =>
            postSyncService.syncPost({
              page_id: fbPage.id,
              fb_post_id: fbPost.id,
              message: fbPost.message,
              type: fbPost.status_type,
              full_picture: fbPost.full_picture || null,
              comments_count: fbPost.comments?.summary?.total_count || 0,
              shares_count: fbPost.shares?.count || 0,
              permalink: fbPost.permalink_url,
              created_time: fbPost.created_time,
            })
          );

          for (const syncedPost of syncedPosts) {
            allPostJobs.push({
              pageId: syncedPage.id,
              postId: syncedPost.id,
              fbPostId: syncedPost.fb_post_id,
              accessToken,
            });
          }

          nextPageUrl = postsPage.paging?.next;
          pageNum++;
        } while (nextPageUrl);

        // Enqueue ALL post-sync jobs in one bulk write.
        let postsQueued = 0;
        if (allPostJobs.length > 0) {
          await facebookSyncQueue.enqueuePostSyncBulk(allPostJobs);
          postsQueued = allPostJobs.length;
        }

        const [pageInsights, pageEarningsSaved] = await Promise.all([
          pageInsightsPromise,
          pageSyncService.syncPageCMEarningsForWindow(fbPage.id, accessToken, since, syncUntil, postsCollected),
        ]);

        await connectedPageRepository.clearFacebookReauthRequired(syncedPage.id, syncStartedAt);
        await syncJobService.updateSyncJob(syncJob.id, "completed");

        console.log(
          `[facebook-sync] 🎉 Page ${fbPage.id}: ${postsCollected.length} posts saved, ${postsQueued} insight jobs queued, ${pageInsights.length} page insights, ${pageEarningsSaved} earnings rows.`
        );

        return {
          pageId: syncedPage.id,
          fbPageId: fbPage.id,
          pageName: syncedPage.page_name || fbPage.name || null,
          postsSaved: postsCollected.length,
          postsQueued,
          pageInsightsSaved: pageInsights.length,
        };
      } catch (error) {
        console.error(`[facebook-sync] ❌ Error syncing page ${fbPage.id}:`, error);
        if (isFacebookTokenError(error)) {
          try {
            await connectedPageRepository.markFacebookReauthRequiredByFbPageId(
              fbPage.id,
              payload.partnerId
            );
          } catch (statusError) {
            console.error(`[facebook-sync] Failed to mark page ${fbPage.id} for Facebook reconnection:`, statusError);
          }
        }
        if (syncJob) {
          await syncJobService.updateSyncJob(
            syncJob.id,
            "failed",
            error instanceof Error ? error.message : String(error)
          );
        }
        throw error;
      }
    });
  }

  async processPostSyncJob(payload: PostSyncJobPayload): Promise<PostSyncJobResult> {
    return this.run("processPostSyncJob", async () => {
      const syncJob = await syncJobService.createSyncJob(payload.pageId, "post_sync");
      const syncUntil = new Date().toISOString();
      const since = this.getWindowStart(DEFAULT_SYNC_WINDOW_DAYS);

      try {
        await syncJobService.updateSyncJob(syncJob.id, "running");

        // Single Graph call now returns both insights + earnings; both DB
        // writes run in parallel inside syncPostInsightsAndEarnings.
        const [{ insights, earningsSaved }, post] = await Promise.all([
          postSyncService.syncPostInsightsAndEarnings({
            fbPostId: payload.fbPostId,
            facebookPostId: payload.fbPostId,
            accessToken: payload.accessToken,
            metrics: DEFAULT_POST_METRICS,
            since,
            until: syncUntil,
          }),
          postRepository.getPostById(payload.postId),
        ]);

        if (!post) throw new Error(`Post ${payload.postId} not found`);

        await syncJobService.updateSyncJob(syncJob.id, "completed");

        if (earningsSaved > 0) {
          console.log(`[facebook-sync] 💰 ${earningsSaved} earnings rows for ${payload.fbPostId}`);
        }

        return { post, insightsSaved: insights.length };
      } catch (error) {
        console.error(`[facebook-sync] ❌ Error syncing post ${payload.fbPostId}:`, error);
        if (isFacebookTokenError(error)) {
          try {
            await connectedPageRepository.markFacebookReauthRequired(payload.pageId);
          } catch (statusError) {
            console.error(`[facebook-sync] Failed to mark page ${payload.pageId} for Facebook reconnection:`, statusError);
          }
        }
        await syncJobService.updateSyncJob(
          syncJob.id,
          "failed",
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    });
  }

  private getWindowStart(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }
}

export default new FacebookSyncOrchestrator();
