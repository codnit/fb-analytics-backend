import type { NextFunction, Request, Response } from "express";
import { BaseController } from "../core/base.controller";
import { Queue } from "bullmq";
import { getRedisConnectionUrl } from "../config/redis";
import { syncQueue, pagePostsSyncQueue, postMetadataSyncQueue } from "../queues/syncQueue";

// Lazy-init a Queue handle for the facebook-sync queue (read-only, for management)
let facebookSyncQueue: Queue | null = null;
const getFacebookSyncQueue = (): Queue => {
  if (!facebookSyncQueue) {
    facebookSyncQueue = new Queue("facebook-sync", {
      connection: { url: getRedisConnectionUrl() },
    });
  }
  return facebookSyncQueue;
};

interface QueueResetResult {
  name: string;
  removed: Record<string, number>;
  error?: string;
}

export class QueueController extends BaseController {
  /**
   * POST /queues/reset
   * Drains and cleans all BullMQ queues (removes every job in every state).
   */
  resetAll = async (_req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const queues: { name: string; instance: Queue }[] = [
        { name: "facebook-sync", instance: getFacebookSyncQueue() },
        { name: "sync-post-insights", instance: syncQueue },
        { name: "sync-page-posts", instance: pagePostsSyncQueue },
        { name: "sync-post-metadata", instance: postMetadataSyncQueue },
      ];

      const results: QueueResetResult[] = [];

      for (const q of queues) {
        try {
          // Get counts before cleaning so we can report what was removed
          const counts = await q.instance.getJobCounts(
            "waiting", "active", "delayed", "failed", "completed"
          );

          // drain removes all waiting + delayed jobs
          await q.instance.drain();

          // obliterate removes everything including completed/failed history
          // force: true allows obliterating even if there are active jobs
          await q.instance.obliterate({ force: true });

          results.push({ name: q.name, removed: counts });
        } catch (err) {
          results.push({
            name: q.name,
            removed: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const totalRemoved = results.reduce(
        (sum, r) =>
          sum + r.removed.waiting + r.removed.active + r.removed.delayed + r.removed.failed + r.removed.completed,
        0
      );

      return this.ok(
        res,
        { results, totalRemoved },
        `All queues reset. ${totalRemoved} jobs removed.`
      );
    } catch (error) {
      return next(error);
    }
  };

  /**
   * GET /queues/status
   * Returns job counts for every queue.
   */
  getStatus = async (_req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const queues: { name: string; instance: Queue }[] = [
        { name: "facebook-sync", instance: getFacebookSyncQueue() },
        { name: "sync-post-insights", instance: syncQueue },
        { name: "sync-page-posts", instance: pagePostsSyncQueue },
        { name: "sync-post-metadata", instance: postMetadataSyncQueue },
      ];

      const status = await Promise.all(
        queues.map(async (q) => {
          try {
            const counts = await q.instance.getJobCounts(
              "waiting", "active", "delayed", "failed", "completed", "paused"
            );
            return { name: q.name, counts };
          } catch (err) {
            return { name: q.name, error: err instanceof Error ? err.message : String(err) };
          }
        })
      );

      return this.ok(res, status, "Queue status retrieved");
    } catch (error) {
      return next(error);
    }
  };
}

export default new QueueController();
