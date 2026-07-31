import { BaseService } from "../../core/base.service";
import connectedPageRepository from "../../repositories/ConnectedPage";
import pageInsightsRepository from "../../repositories/PageInsights";
import postRepository from "../../repositories/Post";
import earningsRepository from "../../repositories/Earnings";
import type { PageInsightCreateInput, PageInsightEntity } from "../../types/domain";
import { DEFAULT_PAGE_METRICS } from "../facebookSync.presets";
import pageSyncService from "../facebook/page.sync.service";
import {
  resolveInsightCache,
  resolveStoredToken,
} from "../../utils/insight-cache.helpers";
import { getExpectedEarningsDayCount } from "../../utils/earnings.helpers";
import { isFacebookTokenError } from "../../utils/facebookAuthError";

export class PageInsightsService extends BaseService {
  constructor() {
    super("PageInsightsService");
  }

  createPageInsight(insightData: PageInsightCreateInput): Promise<PageInsightEntity> {
    return pageInsightsRepository.createPageInsight(insightData);
  }

  private async markPageReconnectRequired(
    fbPageId: string,
    error?: unknown,
    reason = "facebook_page_token_invalid"
  ): Promise<void> {
    if (error && !isFacebookTokenError(error)) {
      return;
    }

    try {
      const connectedPage = await connectedPageRepository.getPageByFbPageId(fbPageId);
      if (connectedPage) {
        await connectedPageRepository.markFacebookReauthRequired(connectedPage.id, reason);
      }
    } catch (statusError) {
      console.error(`[page-insights] Failed to mark ${fbPageId} for Facebook reconnection:`, statusError);
    }
  }

  /**
   * Completely independent from the page_insights cache.
   * Checks cm_earnings_page for complete daily coverage of the requested
   * earnings range and fetches from Facebook when any day is missing.
   * skipBreakdown=true means no per-post getPostWithInsights calls
   * (avoids 268 × 30s timeout chain).
   */
  async ensurePageEarnings(
    fbPageId: string,
    since: string,
    until: string
  ): Promise<void> {
    try {
      const existing = await earningsRepository.getPageEarningsForPerformanceRange(
        fbPageId,
        since,
        until
      );
      const expectedDays = getExpectedEarningsDayCount(since, until);
      const coveredDays = new Set(
        existing
          .filter((row) => row.end_time && (row.period || "day") === "day")
          .map((row) => row.end_time?.toISOString().slice(0, 10))
      ).size;

      if (expectedDays === 0 || coveredDays >= expectedDays) {
        return; // The complete requested earnings window is already cached.
      }

      const connectedPage = await connectedPageRepository.getPageByFbPageId(fbPageId);
      const accessToken = resolveStoredToken(connectedPage?.page_token_encrypted);

      if (!accessToken) {
        if (connectedPage) {
          await this.markPageReconnectRequired(fbPageId, undefined, "missing_page_token");
        }
        console.warn(`[page-earnings] No stored token for ${fbPageId}, cannot sync earnings`);
        return;
      }

      console.log(`[page-earnings] Missing earnings for ${fbPageId} (${since} → ${until}), fetching from Facebook…`);

      // We now fetch breakdown directly from the API, so no need to skip it!
      await pageSyncService.syncPageCMEarningsForWindow(
        fbPageId,
        accessToken,
        since,
        until,
        []
      );
    } catch (error) {
      await this.markPageReconnectRequired(fbPageId, error);
      // Non-fatal: log and continue so the controller can still return cached insights
      console.warn(
        `[page-earnings] Could not ensure earnings for ${fbPageId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async getPageInsights(
    fbPageId: string,
    options: { since?: string; until?: string } = {}
  ): Promise<PageInsightEntity[]> {
    return resolveInsightCache<PageInsightEntity>({
      entityId: fbPageId,
      options,
      defaultMetrics: DEFAULT_PAGE_METRICS,
      loadAllFromDb: (pageId, query) => pageInsightsRepository.getPageInsights(pageId, query),
      loadMetricFromDb: (pageId, metricName, query) => pageInsightsRepository.getPageMetrics(pageId, metricName, query),
      resolveAccessToken: async (pageId) => {
        const connectedPage = await connectedPageRepository.getPageByFbPageId(pageId);
        return resolveStoredToken(connectedPage?.page_token_encrypted);
      },
      fetchMissingFromApi: async (pageId, accessToken, metrics, window) => {
        try {
          // Sync page insights metrics (impressions, fans, etc.)
          await pageSyncService.syncPageInsights({
            pageId,
            facebookPageId: pageId,
            accessToken,
            metrics,
            period: "day",
            since: window.since,
            until: window.until,
          });

          // Also sync page earnings for the missing window
          await pageSyncService.syncPageCMEarningsForWindow(
            pageId,
            accessToken,
            window.since,
            window.until,
            []
          );
        } catch (error) {
          await this.markPageReconnectRequired(pageId, error);
          throw error;
        }
      },
    });
  }

  async getPageMetrics(
    fbPageId: string,
    metricName: string,
    options: { since?: string; until?: string } = {}
  ): Promise<PageInsightEntity[]> {
    return resolveInsightCache<PageInsightEntity>({
      entityId: fbPageId,
      options,
      metricName,
      defaultMetrics: DEFAULT_PAGE_METRICS,
      loadAllFromDb: (pageId, query) => pageInsightsRepository.getPageInsights(pageId, query),
      loadMetricFromDb: (pageId, metric, query) => pageInsightsRepository.getPageMetrics(pageId, metric, query),
      resolveAccessToken: async (pageId) => {
        const connectedPage = await connectedPageRepository.getPageByFbPageId(pageId);
        return resolveStoredToken(connectedPage?.page_token_encrypted);
      },
      fetchMissingFromApi: async (pageId, accessToken, metrics, window) => {
        try {
          await pageSyncService.syncPageInsights({
            pageId,
            facebookPageId: pageId,
            accessToken,
            metrics,
            period: "day",
            since: window.since,
            until: window.until,
          });
        } catch (error) {
          await this.markPageReconnectRequired(pageId, error);
          throw error;
        }
      },
    });
  }
}

export default new PageInsightsService();
