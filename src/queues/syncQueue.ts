import { Queue } from "bullmq";
import { getRedisConnectionUrl } from "../config/redis";

export const syncQueue = new Queue("sync-post-insights", {
    connection: {
        url: getRedisConnectionUrl(),
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

export const pagePostsSyncQueue = new Queue("sync-page-posts", {
    connection: {
        url: getRedisConnectionUrl(),
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
    },
});
