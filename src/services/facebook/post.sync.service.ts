import insightsService from "../insights.service";
import postRepository from "../../repositories/Post";
import postInsightsRepository from "../../repositories/PostInsights";
import earningsRepository from "../../repositories/Earnings";
import type {
  CmEarningsPostEntity,
  PostCreateInput,
  PostEarningsCreateInput,
  PostEntity,
  PostInsightEntity,
} from "../../types/domain";
import {
  EARNINGS_METRICS,
  buildDailyEarningsRows,
  type EarningsInsightEntry,
} from "../../utils/earnings.helpers";
import { dumpApiData } from "../../utils/debug.helpers";
import { DEFAULT_POST_METRICS } from "../facebookSync.presets";

type RawInsightPayload = {
  data?: Array<{
    name: string;
    period?: string;
    values?: Array<{ value: unknown; end_time?: string }>;
  }>;
};

export class PostSyncService {
  async syncPost(postData: {
    page_id: string;
    fb_post_id: string;
    message?: string | null;
    type?: string | null;
    permalink?: string | null;
    created_time?: string | Date | null;
    full_picture?: string | null;
    comments_count?: number | null;
    shares_count?: number | null;
  }): Promise<PostEntity> {
    return postRepository.upsertPost({
      page_id: postData.page_id,
      fb_post_id: postData.fb_post_id,
      message: postData.message || null,
      type: postData.type || null,
      full_picture: postData.full_picture || null,
      comments_count: postData.comments_count || 0,
      shares_count: postData.shares_count || 0,
      permalink: postData.permalink || null,
      created_time: postData.created_time ? new Date(postData.created_time) : undefined,
      synced_at: new Date(),
    } satisfies PostCreateInput);
  }

  /**
   * Fetches insights + earnings metrics for a post in a SINGLE Graph call,
   * then upserts rows in parallel. Previously this made two separate Graph
   * calls (post insights + earnings) and awaited every DB write sequentially.
   */
  async syncPostInsightsAndEarnings(params: {
    fbPostId: string;
    facebookPostId: string;
    accessToken: string;
    metrics?: string[];
    since?: string;
    until?: string;
  }): Promise<{ insights: PostInsightEntity[]; earningsSaved: number }> {
    const baseMetrics = params.metrics?.length ? params.metrics : DEFAULT_POST_METRICS;

    try {
      // Two separate Graph calls — earnings metrics cannot be mixed with others
      const [insightsResponse, earningsResponse] = await Promise.all([
        insightsService.getPostInsights(params.facebookPostId, baseMetrics, {
          access_token: params.accessToken,
          since: params.since,
          until: params.until,
        }),
        insightsService.getPostInsights(params.facebookPostId, EARNINGS_METRICS, {
          access_token: params.accessToken,
          period: "lifetime",
          since: params.since,
          until: params.until,
        }),
      ]);

      if (earningsResponse.success) {
        await dumpApiData(`post_earnings_${params.facebookPostId}`, earningsResponse.data);
      }

      const storedPost = await postRepository.getPostByFbPostId(params.fbPostId);
      if (!storedPost) {
        return { insights: [], earningsSaved: 0 };
      }

      const [insights, earningsSaved] = await Promise.all([
        insightsResponse.success
          ? this.saveInsightsParallel(params.fbPostId, insightsResponse.data as RawInsightPayload)
          : Promise.resolve([]),
        earningsResponse.success
          ? this.saveEarningsParallel(
            params.fbPostId,
            earningsResponse.data as { data?: EarningsInsightEntry[] }
          )
          : Promise.resolve(0),
      ]);

      return { insights, earningsSaved };
    } catch (error) {
      console.warn(
        `[facebook-sync] Skipping post insights/earnings for ${params.facebookPostId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return { insights: [], earningsSaved: 0 };
    }
  }

  /** Backwards-compatible wrapper. */
  async syncPostInsights(params: {
    fbPostId: string;
    facebookPostId: string;
    accessToken: string;
    metrics?: string[];
    since?: string;
    until?: string;
  }): Promise<PostInsightEntity[]> {
    const { insights } = await this.syncPostInsightsAndEarnings(params);
    return insights;
  }

  /** Backwards-compatible wrapper used by other callers. */
  async syncPostCMEarningsForWindow(
    fbPostId: string,
    accessToken: string,
    since: string,
    until: string
  ): Promise<number> {
    const { earningsSaved } = await this.syncPostInsightsAndEarnings({
      fbPostId,
      facebookPostId: fbPostId,
      accessToken,
      metrics: [], // earnings-only call uses just EARNINGS_METRICS via the merge
      since,
      until,
    });
    return earningsSaved;
  }

  private async saveInsightsParallel(
    fbPostId: string,
    insightsData: RawInsightPayload
  ): Promise<PostInsightEntity[]> {
    const rows: Array<Promise<PostInsightEntity>> = [];
    for (const insight of insightsData.data || []) {
      for (const entry of insight.values || []) {
        rows.push(
          postInsightsRepository.upsertPostInsight({
            post_id: fbPostId,
            metric_name: insight.name,
            metric_value: entry.value as never,
            period: insight.period || null,
            end_time: entry.end_time ? new Date(entry.end_time) : undefined,
            synced_at: new Date(),
          })
        );
      }
    }
    return Promise.all(rows);
  }

  private async saveEarningsParallel(
    fbPostId: string,
    payload: { data?: EarningsInsightEntry[] }
  ): Promise<number> {
    const rows = buildDailyEarningsRows(payload);
    if (rows.length === 0) return 0;
    await Promise.all(
      rows.map((row) =>
        this.syncPostEarnings({
          post_id: fbPostId,
          earnings_amount: row.earnings_amount,
          approximate_earnings: row.approximate_earnings,
          currency: row.currency,
          period: row.period,
          end_time: row.end_time,
          synced_at: new Date(),
        })
      )
    );
    return rows.length;
  }

  async syncPostEarnings(earningsData: PostEarningsCreateInput): Promise<CmEarningsPostEntity> {
    return earningsRepository.upsertPostEarnings({
      post_id: earningsData.post_id,
      earnings_amount: earningsData.earnings_amount || 0,
      approximate_earnings: earningsData.approximate_earnings || 0,
      currency: earningsData.currency || "USD",
      period: earningsData.period || null,
      end_time: earningsData.end_time || null,
      synced_at: earningsData.synced_at || new Date(),
    });
  }
}

export default new PostSyncService();
