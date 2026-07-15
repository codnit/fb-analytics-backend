/**
 * CronScheduler
 * -------------
 * Registers repeatable BullMQ jobs on server startup.
 * Called once from server.ts after DB is connected.
 *
 * Jobs registered:
 *   - "cron-full-sync"        → every FULL_SYNC_INTERVAL_HOURS (default: 6)
 *   - "cron-incremental-sync" → every day at 01:00 AM (cron pattern)
 *
 * BullMQ persists repeatable job schedules in Redis — safe to call on every
 * restart, it will not create duplicate schedules.
 */
import { facebookSyncQueue } from "../queues/facebookSync.queue";

export async function startCronScheduler(): Promise<void> {
  const intervalHours = Number(process.env.FULL_SYNC_INTERVAL_HOURS ?? 6);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const publishingStatusIntervalMs = Number(process.env.PUBLISHING_STATUS_SYNC_INTERVAL_MS ?? 60000);

  console.log("[cron-scheduler] Registering cron jobs...", {
    fullSyncEveryHours: intervalHours,
    incrementalSyncPattern: "0 1 * * *",
    publishingStatusEveryMs: publishingStatusIntervalMs,
  });

  try {
    // Full sync — every N hours
    await facebookSyncQueue.registerRepeatableJob(
      facebookSyncQueue.jobNames.cronFullSync,
      { every: intervalMs }
    );

    // Incremental sync — every day at 01:00 AM server time
    await facebookSyncQueue.registerRepeatableJob(
      facebookSyncQueue.jobNames.cronIncrementalSync,
      { pattern: "0 1 * * *" }
    );

    await facebookSyncQueue.registerRepeatableJob(
      facebookSyncQueue.jobNames.cronPublishingStatus,
      { every: publishingStatusIntervalMs }
    );

    console.log("[cron-scheduler] ✅ All cron jobs registered successfully");
  } catch (err) {
    console.error("[cron-scheduler] ❌ Failed to register cron jobs", err);
    // Non-fatal: server continues but cron won't run until fixed
  }
}
