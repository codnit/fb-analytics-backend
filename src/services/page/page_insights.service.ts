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

export class PageInsightsService extends BaseService {
  constructor() {
    super("PageInsightsService");
  }

  createPageInsight(insightData: PageInsightCreateInput): Promise<PageInsightEntity> {
    return pageInsightsRepository.createPageInsight(insightData);
  }

  /**
   * Completely independent from the page_insights cache.
   * Checks cm_earnings_page for the requested date range and
   * fetches from the Facebook API if no rows are found.
   * skipBreakdown=true means no per-post getPostWithInsights calls
   * (avoids 268 × 30s timeout chain).
   */
  async ensurePageEarnings(
    fbPageId: string,
    since: string,
    until: string
  ): Promise<void> {
    try {
      const sinceDate = new Date(since);
      const untilDate = new Date(until);

      // Check if we already have earnings for this window
      const existing = await earningsRepository.getPageEarningsByPageIdsAndRange(
        [fbPageId],
        sinceDate,
        untilDate
      );

      if (existing.length > 0) {
        return; // Already have data — nothing to do
      }

      const connectedPage = await connectedPageRepository.getPageByFbPageId(fbPageId);
      const accessToken = resolveStoredToken(connectedPage?.page_token_encrypted);

      if (!accessToken) {
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
        await pageSyncService.syncPageInsights({
          pageId,
          facebookPageId: pageId,
          accessToken,
          metrics,
          period: "day",
          since: window.since,
          until: window.until,
        });
      },
    });
  }
}

export default new PageInsightsService();
