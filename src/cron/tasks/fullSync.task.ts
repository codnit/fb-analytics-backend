/**
 * FullSyncTask
 * ------------
 * Runs on a configurable interval (default: 6 hours).
 * For each active page in the DB:
 *   - page_insights   -> last 7 days
 *   - cm_earnings_page-> last 7 days
 *   - post fetch      -> last 90 days (to queue lifetime post_insights jobs)
 *   - cm_earnings_post-> last 7 days
 *   - sync_jobs       -> one record per run
 */
import { BaseSyncTask } from "../base.sync-task";
import insightsService from "../../services/insights.service";
import pageRepository from "../../repositories/ConnectedPage";
import { decryptPageToken } from "../../utils/pageTokenCrypto";
import type { FacebookPost } from "../../types/facebook";
import pageSyncService from "../../services/facebook/page.sync.service";
import postSyncService from "../../services/facebook/post.sync.service";
import syncJobService from "../../services/facebook/sync-job.service";
import {
  DEFAULT_PAGE_METRICS,
  DEFAULT_POST_FETCH_LIMIT,
  DEFAULT_POST_METRICS,
} from "../../services/facebookSync.presets";
import { isFacebookTokenError } from "../../utils/facebookAuthError";

const FULL_SYNC_PAGE_INSIGHT_DAYS = 7;
const FULL_SYNC_POST_INSIGHT_DAYS = 90;
const FULL_SYNC_EARNINGS_DAYS = 7;

class FullSyncTask extends BaseSyncTask {
  protected readonly taskName = "full-sync";

  async execute(): Promise<void> {
    this.log("🚀 Starting full sync run...");

    const pages = await pageRepository.getAllActivePages();
    this.log(`Found ${pages.length} active pages to sync`);

    let totalPageInsightsSaved = 0;
    let totalPostInsightsSaved = 0;
    let totalPageEarningsSaved = 0;
    let totalPostEarningsSaved = 0;
    let pagesSucceeded = 0;
    let pagesFailed = 0;

    for (const page of pages) {
      const syncJob = await syncJobService.createSyncJob(page.id, "cron_full_sync");
      const syncStartedAt = new Date();

      try {
        await syncJobService.updateSyncJob(syncJob.id, "running");

        if (!page.page_token_encrypted) {
          this.warn(`No token for page ${page.fb_page_id}, skipping`);
          await pageRepository.markFacebookReauthRequired(page.id, "missing_page_token");
          await syncJobService.updateSyncJob(syncJob.id, "failed", "No page token stored");
          pagesFailed++;
          continue;
        }

        const accessToken = decryptPageToken(page.page_token_encrypted);

        // Refresh Page Metadata (Branding, Category, Followers)
        this.log(`Refreshing page metadata for ${page.fb_page_id}...`);
        try {
          const fbPage = await insightsService.getPageDetails(page.fb_page_id, { access_token: accessToken });
          await pageSyncService.syncPage({
            partner_id: page.partner_id,
            fb_page_id: page.fb_page_id,
            page_name: fbPage.data.name,
            category: fbPage.data.category,
            picture_url: fbPage.data.picture?.data?.url,
            fan_count: fbPage.data.fan_count,
            page_token_encrypted: accessToken, // Will be re-encrypted
          });
        } catch (metaErr) {
          if (isFacebookTokenError(metaErr)) {
            throw metaErr;
          }
          this.warn(`Failed to refresh metadata for page ${page.fb_page_id}: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
        }

        const syncUntil = this.getTodayIso();
        const pageWindowStart = this.getWindowStart(FULL_SYNC_PAGE_INSIGHT_DAYS);
        const earningsWindowStart = this.getWindowStart(FULL_SYNC_EARNINGS_DAYS);
        const postWindowStart = this.getWindowStart(FULL_SYNC_POST_INSIGHT_DAYS);

        this.log(`Syncing page insights for ${page.fb_page_id}...`);
        const pageInsights = await pageSyncService.syncPageInsights({
          pageId: page.id,
          facebookPageId: page.fb_page_id,
          accessToken,
          metrics: DEFAULT_PAGE_METRICS,
          period: "day",
          since: pageWindowStart,
          until: syncUntil,
        });
        totalPageInsightsSaved += pageInsights.length;

        this.log(`Syncing post insights for page ${page.fb_page_id}...`);

        let nextPageUrl: string | undefined;
        const allFbPosts: FacebookPost[] = [];
        let pageNum = 1;
        let postsSaved = 0;
        let postInsightsProcessed = 0;

        do {
          const postsPage = await insightsService.getPagePostsPage(page.fb_page_id, {
            access_token: accessToken,
            limit: DEFAULT_POST_FETCH_LIMIT,
            since: postWindowStart,
            until: syncUntil,
            nextPageUrl,
          });

          const fbPosts = postsPage.data.filter((rawPost): rawPost is FacebookPost => Boolean(rawPost?.id));
          allFbPosts.push(...fbPosts);
          this.log(`Fetched batch ${pageNum} (${fbPosts.length} posts) from Facebook for page ${page.fb_page_id}`);

          const postJobs: Array<{ fbPostId: string; accessToken: string }> = [];

          for (const fbPost of fbPosts) {
            await postSyncService.syncPost({
              page_id: page.fb_page_id,
              fb_post_id: fbPost.id,
              message: fbPost.message,
              type: fbPost.status_type,
              full_picture: fbPost.full_picture,
              comments_count: fbPost.comments?.summary?.total_count || 0,
              shares_count: fbPost.shares?.count || 0,
              permalink: fbPost.permalink_url,
              created_time: fbPost.created_time,
            });

            postsSaved += 1;
            postJobs.push({
              fbPostId: fbPost.id,
              accessToken,
            });
          }

          if (postJobs.length > 0) {
            await Promise.all(
              postJobs.map(async (job) => {
                const postInsights = await postSyncService.syncPostInsights({
                  fbPostId: job.fbPostId,
                  facebookPostId: job.fbPostId,
                  accessToken: job.accessToken,
                  metrics: DEFAULT_POST_METRICS,
                });
                totalPostInsightsSaved += postInsights.length;

                const postEarningsSaved = await postSyncService.syncPostCMEarningsForWindow(
                  job.fbPostId,
                  job.accessToken,
                  earningsWindowStart,
                  syncUntil
                );
                totalPostEarningsSaved += postEarningsSaved;
              })
            );

            postInsightsProcessed += postJobs.length;
          }

          nextPageUrl = postsPage.paging?.next;
          pageNum++;
        } while (nextPageUrl);

        const pageEarningsSaved = await pageSyncService.syncPageCMEarningsForWindow(
          page.fb_page_id,
          accessToken,
          earningsWindowStart,
          syncUntil,
          allFbPosts
        );
        totalPageEarningsSaved += pageEarningsSaved;

        await pageRepository.clearFacebookReauthRequired(page.id, syncStartedAt);
        await syncJobService.updateSyncJob(syncJob.id, "completed");
        pagesSucceeded++;
        this.log(`✅ Page ${page.fb_page_id} full-synced`);
        this.log(`📈 Page summary: ${postsSaved} posts saved, ${postInsightsProcessed} post insights processed.`);
      } catch (err) {
        this.error(`Failed to full-sync page ${page.fb_page_id}`, err);
        if (isFacebookTokenError(err)) {
          try {
            await pageRepository.markFacebookReauthRequired(page.id);
          } catch (statusError) {
            this.error(`Failed to mark page ${page.fb_page_id} for Facebook reconnection`, statusError);
          }
        }
        await syncJobService.updateSyncJob(
          syncJob.id,
          "failed",
          err instanceof Error ? err.message : String(err)
        );
        pagesFailed++;
      }
    }

    this.log("🎉 Full sync run complete", {
      pagesSucceeded,
      pagesFailed,
      totalPageInsightsSaved,
      totalPostInsightsSaved,
      totalPageEarningsSaved,
      totalPostEarningsSaved,
    });
  }
}

export const cronFullSyncTask = new FullSyncTask();
