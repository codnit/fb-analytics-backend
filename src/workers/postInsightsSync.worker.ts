// src/workers/postInsightsSync.worker.ts
import { Worker, Job } from "bullmq";
import { getRedisConnectionUrl } from "../config/redis";
import postInsightsService from "../services/post/post_insights.service";

const CONCURRENCY = 10; // FB API safe limit

export const postInsightsSyncWorker = new Worker(
    "sync-post-insights",
    async (job: Job) => {
        const { postIds, since, until } = job.data as {
            postIds: string[];
            since?: string;
            until?: string;
        };

        console.log(`🔄 Syncing ${postIds.length} posts...`);

        // Process in chunks to avoid FB rate limits
        for (let i = 0; i < postIds.length; i += CONCURRENCY) {
            const chunk = postIds.slice(i, i + CONCURRENCY);

            await Promise.allSettled(
                chunk.map(async (fbPostId) => {
                    try {
                        await postInsightsService.fetchAndSavePostInsights(fbPostId, { since, until });
                    } catch (err) {
                        console.error(`Failed to sync post ${fbPostId}:`, err);
                    }
                })
            );

            // Small delay between chunks to respect FB rate limits
            if (i + CONCURRENCY < postIds.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    },
    {
        connection: {
            url: getRedisConnectionUrl(),
        },
        concurrency: 1, // one job at a time, chunks handle internal parallelism
    }
);