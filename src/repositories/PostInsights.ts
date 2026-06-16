import { getDB } from "../config/database";
import { BaseRepository } from "../core/base.repository";
import type { AnyRecord, PostInsightCreateInput, PostInsightEntity } from "../types/domain";

const toDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export class PostInsightsRepository extends BaseRepository<PostInsightEntity> {
  protected readonly tableName = "post_insights";

  protected get delegate() {
    return getDB().postInsight;
  }

  createPostInsight(insightData: PostInsightCreateInput): Promise<PostInsightEntity> {
    return this.createRecord(insightData);
  }

  getPostInsights(fbPostId: string, options: { since?: string; until?: string } = {}): Promise<PostInsightEntity[]> {
    const endTimeFilter: AnyRecord = {
      ...(toDate(options.since) ? { gte: toDate(options.since) } : {}),
      ...(toDate(options.until) ? { lte: toDate(options.until) } : {}),
    };

    return this.findManyRecords({
      where: {
        post_id: fbPostId,
        OR: [
          ...(Object.keys(endTimeFilter).length > 0 ? [{ end_time: endTimeFilter }] : []),
          { period: "lifetime" },
          { end_time: null },
        ],
      },
      orderBy: [{ end_time: "desc" }, { synced_at: "desc" }],
    });
  }

  getPostInsightsBatch(
    fbPostIds: string[],
    options: { since?: string; until?: string } = {}
  ): Promise<PostInsightEntity[]> {
    if (fbPostIds.length === 0) return Promise.resolve([]);

    const endTimeFilter: AnyRecord = {
      ...(toDate(options.since) ? { gte: toDate(options.since) } : {}),
      ...(toDate(options.until) ? { lte: toDate(options.until) } : {}),
    };

    return this.findManyRecords({
      where: {
        post_id: { in: fbPostIds },          // ← only diff from getPostInsights
        OR: [
          ...(Object.keys(endTimeFilter).length > 0 ? [{ end_time: endTimeFilter }] : []),
          { period: "lifetime" },
          { end_time: null },
        ],
      },
      orderBy: [{ end_time: "desc" }, { synced_at: "desc" }],
    });
  }

  getPostMetrics(fbPostId: string, metricName: string, options: { since?: string; until?: string } = {}): Promise<PostInsightEntity[]> {
    const endTimeFilter: AnyRecord = {
      ...(toDate(options.since) ? { gte: toDate(options.since) } : {}),
      ...(toDate(options.until) ? { lte: toDate(options.until) } : {}),
    };

    return this.findManyRecords({
      where: {
        post_id: fbPostId,
        metric_name: metricName,
        OR: [
          ...(Object.keys(endTimeFilter).length > 0 ? [{ end_time: endTimeFilter }] : []),
          { period: "lifetime" },
          { end_time: null },
        ],
      },
      orderBy: [{ end_time: "desc" }, { synced_at: "desc" }],
    });
  }

  upsertPostInsight(insightData: PostInsightCreateInput): Promise<PostInsightEntity> {
    return this.upsertByLookup(
      {
        post_id: insightData.post_id,
        metric_name: insightData.metric_name,
        period: insightData.period,
        end_time: insightData.end_time,
      },
      insightData,
      insightData
    );
  }

  /** Incremental sync: check if a row already exists for a given post, metric and date */
  async findByMetricAndDate(postId: string, metricName: string, date: Date): Promise<PostInsightEntity | null> {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);

    const result = await this.delegate.findFirst({
      where: { post_id: postId, metric_name: metricName, end_time: { gte: start, lte: end } },
    });

    return result;
  }
}

export default new PostInsightsRepository();
