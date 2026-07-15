import "dotenv/config";
import { Worker } from "bullmq";
import { connectDB } from "../config/database";
import { getRedisConnectionUrl } from "../config/redis";
import { facebookSyncQueue } from "../queues/facebookSync.queue";
import saveFacebookDataService from "../services/saveFacebookData.service";
import type { PageSyncJobPayload, PostSyncJobPayload } from "../types/facebookSync";
import { cronFullSyncTask } from "../cron/tasks/fullSync.task";
import { cronIncrementalSyncTask } from "../cron/tasks/incrementalSync.task";
import publishingService from "../services/facebook/publishing.service";

let workerInstance: Worker | null = null;

export const startFacebookSyncWorker = (): Worker => {
  if (workerInstance) {
    return workerInstance;
  }

  console.log("[facebook-sync][worker] booting", {
    queue: facebookSyncQueue.queueName,
    concurrency: Number.parseInt(process.env.FACEBOOK_SYNC_WORKER_CONCURRENCY || "25", 10),
    redisConfigured: Boolean(process.env.REDIS_URL || process.env.QUEUE_REDIS_URL),
  });

  workerInstance = new Worker(
    facebookSyncQueue.queueName,
    async (job) => {
      console.log("[facebook-sync][worker] job received", {
        jobId: job.id,
        name: job.name,
      });

      if (job.name === facebookSyncQueue.jobNames.pageSync) {
        return saveFacebookDataService.processPageSyncJob(job.data as PageSyncJobPayload);
      }

      if (job.name === facebookSyncQueue.jobNames.postSync) {
        return saveFacebookDataService.processPostSyncJob(job.data as PostSyncJobPayload);
      }

      if (job.name === facebookSyncQueue.jobNames.cronFullSync) {
        return cronFullSyncTask.execute();
      }

      if (job.name === facebookSyncQueue.jobNames.cronIncrementalSync) {
        return cronIncrementalSyncTask.execute();
      }

      if (job.name === facebookSyncQueue.jobNames.cronPublishingStatus) {
        const publishedCount = await publishingService.reconcileScheduledPosts();
        return { publishedCount };
      }

      throw new Error(`Unsupported job type: ${job.name}`);
    },
    {
      connection: {
        url: getRedisConnectionUrl(),
      },
      concurrency: Number.parseInt(process.env.FACEBOOK_SYNC_WORKER_CONCURRENCY || "5", 10),
    }
  );

  workerInstance.on("ready", () => {
    console.log("[facebook-sync][worker] ready");
  });

  workerInstance.on("active", (job) => {
    console.log("[facebook-sync][worker] job active", {
      jobId: job.id,
      name: job.name,
    });
  });

  workerInstance.on("completed", (job) => {
    console.log("[facebook-sync][worker] job completed", {
      jobId: job.id,
      name: job.name,
    });
  });

  workerInstance.on("failed", (job, error) => {
    console.error("[facebook-sync][worker] job failed", {
      jobId: job?.id,
      name: job?.name,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  workerInstance.on("error", (error) => {
    console.error("[facebook-sync][worker] worker error", error);
  });

  workerInstance.on("closed", () => {
    console.log("[facebook-sync][worker] closed");
  });

  return workerInstance;
};

if (require.main === module) {
  connectDB()
    .then(() => {
      console.log("[facebook-sync][worker] database connected");
      void startFacebookSyncWorker();
      require("./postInsightsSync.worker");
      require("./postsSync.worker");
      require("./postMetadataSync.worker");

    })
    .catch((error) => {
      console.error("[facebook-sync][worker] failed to connect database", error);
      process.exit(1);
    });
}

export default startFacebookSyncWorker;
