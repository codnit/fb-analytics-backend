import { Queue, type Job } from "bullmq";
import { Environment } from "../config/environment";
import { getRedisConnectionUrl } from "../config/redis";
import type { PageSyncJobPayload, PostSyncJobPayload } from "../types/facebookSync";

const queueName = "facebook-sync";

const jobNames = {
  pageSync: "page-sync",
  postSync: "post-sync",
  cronFullSync: "cron-full-sync",
  cronIncrementalSync: "cron-incremental-sync",
  cronPublishingStatus: "cron-publishing-status",
} as const;

let queueInstance: Queue | null = null;

const getQueue = (): Queue => {
  if (!queueInstance) {
    queueInstance = new Queue(queueName, {
      connection: {
        url: getRedisConnectionUrl(),
      },
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }

  return queueInstance;
};

export const facebookSyncQueue = {
  queueName,
  jobNames,

  async enqueuePageSync(data: PageSyncJobPayload): Promise<Job<PageSyncJobPayload>> {
    const job = await getQueue().add(jobNames.pageSync, data);

    console.log(`[facebook-sync][enqueue] page job queued`, {
      jobId: job.id,
      pageId: data.facebookPage.id,
      queue: queueName,
    });

    return job;
  },

  async enqueuePostSync(data: PostSyncJobPayload): Promise<Job<PostSyncJobPayload>> {
    const job = await getQueue().add(jobNames.postSync, data);

    console.log(`[facebook-sync][enqueue] post job queued`, {
      jobId: job.id,
      pageId: data.pageId,
      postId: data.postId,
      fbPostId: data.fbPostId,
      queue: queueName,
    });

    return job;
  },

  async enqueuePostSyncBulk(data: PostSyncJobPayload[]): Promise<Array<Job<PostSyncJobPayload>>> {
    if (data.length === 0) {
      return [];
    }

    return getQueue().addBulk(
      data.map((item) => ({
        name: jobNames.postSync,
        data: item,
      }))
    );
  },

  async registerRepeatableJob(
    jobName: string,
    repeatOptions: { every?: number; pattern?: string }
  ): Promise<void> {
    await getQueue().add(jobName, {}, { repeat: repeatOptions as never });
    console.log(`[cron-scheduler] Repeatable job registered`, { jobName, repeatOptions });
  },

  async getDiagnostics(): Promise<{
    queueName: string;
    redisConfigured: boolean;
    jobCounts?: Record<string, number>;
    recentFailedJobs?: Array<{
      id?: string;
      name: string;
      failedReason?: string;
      stacktrace?: string[];
      processedOn?: number;
      finishedOn?: number;
    }>;
    error?: string;
  }> {
    try {
      const queue = getQueue();
      const jobCounts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
      const failedJobs = await queue.getJobs(["failed"], 0, 9, true);

      return {
        queueName,
        redisConfigured: Boolean(Environment.redisUrl),
        jobCounts,
        recentFailedJobs: failedJobs.map((job) => ({
          id: job.id,
          name: job.name,
          failedReason: job.failedReason,
          stacktrace: job.stacktrace,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
        })),
      };
    } catch (error) {
      return {
        queueName,
        redisConfigured: Boolean(Environment.redisUrl),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
