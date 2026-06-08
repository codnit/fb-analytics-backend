import insightsService from "../insights.service";
import pageRepository from "../../repositories/ConnectedPage";
import pageInsightsRepository from "../../repositories/PageInsights";
import earningsRepository from "../../repositories/Earnings";
import type {
  ConnectedPageCreateInput,
  ConnectedPageEntity,
  CmEarningsPageEntity,
  PageEarningsCreateInput,
  PageInsightEntity,
} from "../../types/domain";
import {
  EARNINGS_METRICS,
  buildContentTypeBreakdown,
  buildDailyEarningsRows,
  createEmptyContentTypeBreakdown,
  type EarningsInsightEntry,
  type EarningsPostSource,
} from "../../utils/earnings.helpers";
import { DEFAULT_PAGE_METRICS } from "../facebookSync.presets";
import { encryptPageToken } from "../../utils/pageTokenCrypto";

export class PageSyncService {
  async syncPage(pageData: {
    partner_id: string;
    fb_page_id: string;
    page_name?: string | null;
    page_token_encrypted?: string | null;
    fan_count?: number | string | bigint;
    is_active?: boolean;
    picture_url?: string | null;
    category?: string | null;
    last_synced_at?: Date | null;
  }): Promise<ConnectedPageEntity> {
    return pageRepository.upsertPage({
      partner_id: pageData.partner_id,
      fb_page_id: pageData.fb_page_id,
      page_name: pageData.page_name || null,
      page_token_encrypted: pageData.page_token_encrypted ? encryptPageToken(pageData.page_token_encrypted) : null,
      fan_count: pageData.fan_count || 0,
      picture_url: pageData.picture_url || null,
      category: pageData.category || null,
      is_active: pageData.is_active !== false,
      last_synced_at: pageData.last_synced_at || new Date(),
    } satisfies ConnectedPageCreateInput);
  }

  async syncPageInsights(params: {
    pageId: string;
    facebookPageId: string;
    accessToken: string;
    metrics?: string[];
    period?: string;
    since?: string;
    until?: string;
  }): Promise<PageInsightEntity[]> {
    const results: PageInsightEntity[] = [];
    const effectiveMetrics: string[] = Array.from(
      new Set(params.metrics && params.metrics.length > 0 ? params.metrics : DEFAULT_PAGE_METRICS)
    );

    try {
      const fbResponse = await insightsService.getPageInsights(params.facebookPageId, effectiveMetrics, {
        access_token: params.accessToken,
        period: params.period || "day",
        since: params.since,
        until: params.until,
      });

      if (!fbResponse.success) {
        throw new Error("Failed to fetch page insights");
      }

      const payload = fbResponse.data as { data?: Array<{ name: string; period?: string; values?: Array<{ value: unknown; end_time?: string }> }> };

      for (const insight of payload.data || []) {
        for (const entry of insight.values || []) {
          const saved = await pageInsightsRepository.upsertPageInsight({
            page_id: params.facebookPageId,
            metric_name: insight.name,
            metric_value: entry.value as never,
            period: insight.period || "day",
            end_time: entry.end_time ? new Date(entry.end_time) : undefined,
            synced_at: new Date(),
          });
          results.push(saved);
        }
      }
    } catch (error) {
      console.warn(
        `[facebook-sync] Skipping page insight metric "${effectiveMetrics}" for ${params.facebookPageId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    return results;
  }

  async syncPageEarnings(earningsData: PageEarningsCreateInput): Promise<CmEarningsPageEntity> {
    return earningsRepository.upsertPageEarnings({
      page_id: earningsData.page_id,
      earnings_amount: earningsData.earnings_amount || 0,
      approximate_earnings: earningsData.approximate_earnings || 0,
      currency: earningsData.currency || "USD",
      period: earningsData.period || null,
      end_time: earningsData.end_time || null,
      content_type_breakdown: earningsData.content_type_breakdown || null,
      synced_at: earningsData.synced_at || new Date(),
    });
  }

  async syncPageCMEarningsForWindow(
    pageId: string,
    accessToken: string,
    since: string,
    until: string,
    posts: EarningsPostSource[]
  ): Promise<number> {
    try {
      const response = await insightsService.getPageInsights(pageId, EARNINGS_METRICS, {
        access_token: accessToken,
        period: "day",
        since,
        until,
      });

      if (!response.success) {
        return 0;
      }

      const pageRows = buildDailyEarningsRows(response.data as { data?: EarningsInsightEntry[] });
      const breakdownByDate = await buildContentTypeBreakdown(
        posts,
        accessToken,
        since,
        until,
        insightsService.getPostWithInsights.bind(insightsService)
      );

      let savedCount = 0;

      for (const row of pageRows) {
        await this.syncPageEarnings({
          page_id: pageId,
          earnings_amount: row.earnings_amount,
          approximate_earnings: row.approximate_earnings,
          currency: row.currency,
          period: row.period,
          end_time: row.end_time,
          content_type_breakdown: breakdownByDate.get(`${row.end_time.toISOString()}_${row.period || "day"}`) || createEmptyContentTypeBreakdown(),
          synced_at: new Date(),
        });
        savedCount += 1;
      }

      return savedCount;
    } catch (error) {
      console.warn(
        `[facebook-sync] Skipping page earnings sync for ${pageId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return 0;
    }
  }
}

export default new PageSyncService();
