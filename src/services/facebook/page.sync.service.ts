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
  buildContentTypeBreakdownFromInsights,
  buildDailyEarningsRows,
  createEmptyContentTypeBreakdown,
  type EarningsInsightEntry,
  type EarningsPostSource,
} from "../../utils/earnings.helpers";
import { dumpApiData } from "../../utils/debug.helpers";
import { DEFAULT_PAGE_METRICS } from "../facebookSync.presets";
import { encryptPageToken } from "../../utils/pageTokenCrypto";
import axios from "axios";
import { Environment } from "../../config/environment";

const normalizePermissions = (debugData: any): string[] => {
  const scopes = Array.isArray(debugData?.scopes) ? debugData.scopes : [];
  const granularScopes = Array.isArray(debugData?.granular_scopes)
    ? debugData.granular_scopes.map((item: { scope?: string }) => item.scope).filter(Boolean)
    : [];

  return Array.from(new Set([...scopes, ...granularScopes])).sort();
};

export class PageSyncService {
  async syncPage(pageData: {
    partner_id: string;
    fb_page_id: string;
    page_name?: string | null;
    page_token_encrypted?: string | null;
    publishing_enabled?: boolean;
    publishing_granted_at?: Date | null;
    publishing_granted_by?: string | null;
    granted_scopes?: string[];
    fan_count?: number | string | bigint;
    is_active?: boolean;
    picture_url?: string | null;
    category?: string | null;
    last_synced_at?: Date | null;
  }): Promise<ConnectedPageEntity> {
    const pageAccessToken = pageData.page_token_encrypted || null;
    const encryptedPageToken = pageAccessToken ? encryptPageToken(pageAccessToken) : null;
    const inspectedPermissions = pageData.publishing_enabled && pageAccessToken
      ? await this.getTokenPermissions(pageAccessToken)
      : undefined;
    const grantedScopes = Array.isArray(pageData.granted_scopes) ? pageData.granted_scopes : [];
    const permissions = pageData.publishing_enabled
      ? Array.from(new Set([...(inspectedPermissions || []), ...grantedScopes])).sort()
      : undefined;
    const publishingEnabled = pageData.publishing_enabled
      ? Boolean(pageAccessToken) && permissions?.includes("pages_manage_posts") === true
      : undefined;
    const permissionsCheckedAt = pageData.publishing_enabled ? new Date() : undefined;

    const page = await pageRepository.upsertPage({
      partner_id: pageData.partner_id,
      fb_page_id: pageData.fb_page_id,
      page_name: pageData.page_name || null,
      page_token_encrypted: encryptedPageToken,
      publishing_enabled: publishingEnabled,
      publishing_granted_at: pageData.publishing_granted_at,
      publishing_granted_by: pageData.publishing_granted_by,
      facebook_permissions: permissions,
      permissions_checked_at: permissionsCheckedAt,
      fan_count: pageData.fan_count || 0,
      picture_url: pageData.picture_url || null,
      category: pageData.category || null,
      is_active: pageData.is_active !== false,
      last_synced_at: pageData.last_synced_at || new Date(),
    } satisfies ConnectedPageCreateInput);

    if (pageData.publishing_enabled) {
      await pageRepository.updatePublishingForFbPage(pageData.fb_page_id, {
        publishing_enabled: publishingEnabled === true,
        publishing_granted_at: pageData.publishing_granted_at || new Date(),
        publishing_granted_by: pageData.publishing_granted_by || pageData.partner_id,
        facebook_permissions: permissions || [],
        permissions_checked_at: permissionsCheckedAt || new Date(),
      });
    }

    return page;
  }

  private async getTokenPermissions(pageAccessToken: string): Promise<string[]> {
    const appAccessToken = Environment.facebookAppAccessToken;
    if (!appAccessToken) {
      return [];
    }

    try {
      const response = await axios.get(`${Environment.facebookGraphBaseUrl}/debug_token`, {
        params: {
          input_token: pageAccessToken,
          access_token: appAccessToken,
        },
      });

      return normalizePermissions(response.data?.data);
    } catch (error) {
      console.warn("[facebook-sync] Unable to inspect page token permissions:", error instanceof Error ? error.message : String(error));
      return [];
    }
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
    posts: EarningsPostSource[],
    skipBreakdown = false
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

      // Fetch the per-post content-type breakdown from the API using breakdown=earning_source
      let breakdownByDate = new Map<string, ReturnType<typeof createEmptyContentTypeBreakdown>>();
      if (!skipBreakdown) {
        try {
          const breakdownResponse = await insightsService.getPageInsights(pageId, ["content_monetization_earnings"], {
            access_token: accessToken,
            period: "day",
            breakdown: "earning_source",
            since,
            until,
          });

          console.log(`[facebook-sync] Breakdown API Response Success: ${breakdownResponse.success}`);

          if (breakdownResponse.success) {
            const rawData = breakdownResponse.data as any;
            console.log(`[facebook-sync] Breakdown API Response Data Keys:`, Object.keys(rawData || {}));
            
            if (rawData.data && Array.isArray(rawData.data)) {
              console.log(`[facebook-sync] Breakdown API Entries Count:`, rawData.data.length);
              if (rawData.data.length > 0) {
                 console.log(`[facebook-sync] Sample Breakdown Entry:`, JSON.stringify(rawData.data[0]).substring(0, 300));
              }
            }

            breakdownByDate = buildContentTypeBreakdownFromInsights(rawData);
            console.log(`[facebook-sync] Extracted breakdown keys:`, Array.from(breakdownByDate.keys()));
          } else {
             console.log(`[facebook-sync] Breakdown API failed:`, breakdownResponse);
          }
        } catch (breakdownError) {
          console.warn(
            `[facebook-sync] Content-type breakdown fetch failed for ${pageId}, saving earnings without breakdown:`,
            breakdownError instanceof Error ? breakdownError.message : String(breakdownError)
          );
        }
      }

      let savedCount = 0;

      console.log(`[facebook-sync] Breakdown Keys available:`, Array.from(breakdownByDate.keys()));

      for (const row of pageRows) {
        const key = row.end_time ? `${row.end_time.toISOString()}_${row.period || "day"}` : `no_date_${row.period || "day"}`;
        
        console.log(`[facebook-sync] Checking breakdown for key: ${key}`);
        const breakdown = breakdownByDate.get(key);
        if (!breakdown) {
          console.log(`[facebook-sync] -> NO MATCH FOUND for ${key}`);
        } else {
          console.log(`[facebook-sync] -> MATCH FOUND for ${key}:`, JSON.stringify(breakdown));
        }

        await this.syncPageEarnings({
          page_id: pageId,
          earnings_amount: row.earnings_amount,
          approximate_earnings: row.approximate_earnings,
          currency: row.currency,
          period: row.period,
          end_time: row.end_time,
          content_type_breakdown: breakdown || createEmptyContentTypeBreakdown(),
          synced_at: new Date(),
        });
        savedCount += 1;
      }

      console.log(`[facebook-sync] 💰 Page ${pageId}: ${savedCount} earnings rows saved for window ${since} → ${until}`);
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
