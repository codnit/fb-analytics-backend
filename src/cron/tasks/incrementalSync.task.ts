/**
 * IncrementalSyncTask
 * -------------------
 * Runs once daily (default: 1:00 AM).
 * For each active page:
 *   - page_insights and earnings tables check yesterday's daily row
 *   - post_insights checks lifetime metrics already stored for each post
 *   - missing rows are fetched from Facebook and appended
 *
 * Tables covered:
 *   - page_insights
 *   - post_insights
 *   - cm_earnings_page
 *   - cm_earnings_post
 *   - sync_jobs
 */
import { BaseSyncTask } from "../base.sync-task";
import pageRepository from "../../repositories/ConnectedPage";
import postRepository from "../../repositories/Post";
import pageInsightsRepository from "../../repositories/PageInsights";
import postInsightsRepository from "../../repositories/PostInsights";
import earningsRepository from "../../repositories/Earnings";
import { decryptPageToken } from "../../utils/pageTokenCrypto";
import pageSyncService from "../../services/facebook/page.sync.service";
import postSyncService from "../../services/facebook/post.sync.service";
import syncJobService from "../../services/facebook/sync-job.service";
import insightsService from "../../services/insights.service";
import {
  DEFAULT_PAGE_METRICS,
  DEFAULT_POST_METRICS,
} from "../../services/facebookSync.presets";
import { isFacebookTokenError } from "../../utils/facebookAuthError";

class IncrementalSyncTask extends BaseSyncTask {
  protected readonly taskName = "incremental-sync";

  async execute(): Promise<void> {
    this.log("🚀 Starting incremental sync run...");

    const yesterday = this.getYesterday();
    const since = this.getYesterdayIso();
    const until = this.getTodayIso();

    const pages = await pageRepository.getAllActivePages();
    this.log(`Found ${pages.length} active pages`, { date: yesterday.toISOString().split("T")[0] });

    let pageInsightsAppended = 0;
    let postInsightsAppended = 0;
    let earningsPageAppended = 0;
    let earningsPostAppended = 0;
    let pagesSucceeded = 0;
    let pagesFailed = 0;

    for (const page of pages) {
      const syncJob = await syncJobService.createSyncJob(page.id, "cron_incremental_sync");
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

        for (const metric of DEFAULT_PAGE_METRICS) {
          const existing = await pageInsightsRepository.findByMetricAndDate(
            page.fb_page_id,
            metric,
            yesterday
          );

          if (existing) {
            continue;
          }

          this.log(`Appending missing page insight: ${metric} for ${page.fb_page_id}`);
          const saved = await pageSyncService.syncPageInsights({
            pageId: page.id,
            facebookPageId: page.fb_page_id,
            accessToken,
            metrics: [metric],
            period: "day",
            since,
            until,
          });
          pageInsightsAppended += saved.length;
        }

        const posts = await postRepository.getPagePosts(page.id);

        const existingPageEarnings = await earningsRepository.findPageEarningsByDate(
          page.fb_page_id,
          yesterday
        );

        if (!existingPageEarnings) {
          this.log(`Appending missing page earnings for ${page.fb_page_id}`);
          const saved = await pageSyncService.syncPageCMEarningsForWindow(
            page.fb_page_id,
            accessToken,
            since,
            until,
            posts
          );
          earningsPageAppended += saved;
        }

        for (const post of posts) {
          try {
            // Refresh Post Metadata (Comments Count, etc.)
            const fbPostResponse = await insightsService.getPostWithInsights(post.fb_post_id, { access_token: accessToken });
            const fbPost = fbPostResponse.data;
            await postSyncService.syncPost({
              page_id: page.fb_page_id,
              fb_post_id: fbPost.id,
              message: fbPost.message,
              type: fbPost.status_type,
              full_picture: fbPost.full_picture || null,
              comments_count: fbPost.comments?.summary?.total_count || 0,
              shares_count: fbPost.shares?.count || 0,
              permalink: fbPost.permalink_url,
              created_time: fbPost.created_time,
            });

            const existingPostInsights = await postInsightsRepository.getPostInsights(post.fb_post_id);
            const existingMetrics = new Set(existingPostInsights.map((insight) => insight.metric_name));

            for (const metric of DEFAULT_POST_METRICS) {
              if (existingMetrics.has(metric)) {
                continue;
              }

              this.log(`Appending missing post insight: ${metric} for ${post.fb_post_id}`);
              const saved = await postSyncService.syncPostInsights({
                fbPostId: post.fb_post_id,
                facebookPostId: post.fb_post_id,
                accessToken,
                metrics: [metric],
              });
              postInsightsAppended += saved.length;
            }

            const existingPostEarnings = await earningsRepository.findPostEarningsByDate(
              post.fb_post_id,
              yesterday
            );

            if (!existingPostEarnings) {
              this.log(`Appending missing post earnings for ${post.fb_post_id}`);
              const saved = await postSyncService.syncPostCMEarningsForWindow(
                post.fb_post_id,
                accessToken,
                since,
                until
              );
              earningsPostAppended += saved;
            }
          } catch (postErr) {
            if (isFacebookTokenError(postErr)) {
              throw postErr;
            }
            this.warn(`Failed incremental sync for post ${post.fb_post_id}`, {
              error: postErr instanceof Error ? postErr.message : String(postErr),
            });
          }
        }

        await pageRepository.clearFacebookReauthRequired(page.id, syncStartedAt);
        await syncJobService.updateSyncJob(syncJob.id, "completed");
        pagesSucceeded++;
        this.log(`✅ Page ${page.fb_page_id} incremental-synced`);
      } catch (err) {
        this.error(`Failed incremental sync for page ${page.fb_page_id}`, err);
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

    this.log("🎉 Incremental sync run complete", {
      pagesSucceeded,
      pagesFailed,
      pageInsightsAppended,
      postInsightsAppended,
      earningsPageAppended,
      earningsPostAppended,
    });
  }
}

export const cronIncrementalSyncTask = new IncrementalSyncTask();
