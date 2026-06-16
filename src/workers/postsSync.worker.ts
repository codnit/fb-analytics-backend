import { Worker, Job } from "bullmq";
import { getRedisConnectionUrl } from "../config/redis";
import { PostInsightsService } from "../services/post/post_insights.service";
import connectedPageRepository from "../repositories/ConnectedPage";
import { resolveStoredToken } from "../utils/insight-cache.helpers";
import insightsService from "../services/insights.service";
import postSyncService, { PostSyncService } from "../services/facebook/post.sync.service";
import { DEFAULT_POST_FETCH_LIMIT } from "../services/facebookSync.presets";
import { FacebookPost } from "../types/facebook";


export const pagePostsSyncWorker = new Worker(
    "sync-page-posts",
    async (job: Job) => {
        const { pageId, missingWindows } = job.data as {
            pageId: string;
            missingWindows: { since: string; until: string }[];
        };

        console.log(`🔄 Syncing ${missingWindows.length} missing windows for page ${pageId}`);

        const connectedPage = await connectedPageRepository.getPageByFbPageId(pageId);
        const accessToken = resolveStoredToken(connectedPage?.page_token_encrypted);

        if (!accessToken) {
            throw new Error(`No stored token found for page ${pageId}`);
        }

        for (const window of missingWindows) {
            const response = await insightsService.getPagePosts(pageId, {
                access_token: accessToken,
                since: window.since,
                until: window.until,
                limit: DEFAULT_POST_FETCH_LIMIT,
                fetchAll: true,
            });

            for (const post of response.data as FacebookPost[]) {
                if (!post?.id) continue;

                await postSyncService.syncPost({
                    page_id: pageId,
                    fb_post_id: post.id,
                    message: post.message,
                    type: post.status_type,
                    full_picture: post.full_picture || null,
                    comments_count: post.comments?.summary?.total_count || 0,
                    shares_count: post.shares?.count || 0,
                    permalink: post.permalink_url,
                    created_time: post.created_time,
                });
            }

            console.log(`✅ Synced window ${window.since} → ${window.until}`);
        }
    },
    {
        connection: {
            url: getRedisConnectionUrl(),
        }, concurrency: 1
    }
);