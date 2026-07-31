import { BaseService } from "../../core/base.service";
import connectedPageRepository from "../../repositories/ConnectedPage";
import postRepository from "../../repositories/Post";
import postInsightsRepository from "../../repositories/PostInsights";
import type { PostInsightCreateInput, PostInsightEntity } from "../../types/domain";
import { DEFAULT_POST_METRICS } from "../facebookSync.presets";
import postSyncService from "../facebook/post.sync.service";
import {
  resolveInsightCache,
  resolveStoredToken,
} from "../../utils/insight-cache.helpers";
import { isFacebookTokenError } from "../../utils/facebookAuthError";

export class PostInsightsService extends BaseService {
  constructor() {
    super("PostInsightsService");
  }

  createPostInsight(insightData: PostInsightCreateInput): Promise<PostInsightEntity> {
    return postInsightsRepository.createPostInsight(insightData);
  }

  private async markPostPageReconnectRequired(
    fbPostId: string,
    error?: unknown,
    reason = "facebook_page_token_invalid"
  ): Promise<void> {
    if (error && !isFacebookTokenError(error)) {
      return;
    }

    try {
      const post = await postRepository.getPostByFbPostId(fbPostId);
      const connectedPage = post
        ? await connectedPageRepository.getPageByFbPageId(post.page_id)
        : null;

      if (connectedPage) {
        await connectedPageRepository.markFacebookReauthRequired(connectedPage.id, reason);
      }
    } catch (statusError) {
      console.error(`[post-insights] Failed to mark the page for post ${fbPostId} for Facebook reconnection:`, statusError);
    }
  }

  async fetchAndSavePostInsights(
    fbPostId: string,
    options: { since?: string; until?: string } = {}
  ): Promise<void> {
    const post = await postRepository.getPostByFbPostId(fbPostId);
    const connectedPage = post
      ? await connectedPageRepository.getPageByFbPageId(post.page_id)
      : null;

    const accessToken = resolveStoredToken(connectedPage?.page_token_encrypted);
    if (!accessToken) {
      await this.markPostPageReconnectRequired(fbPostId, undefined, "missing_page_token");
      throw new Error(`No access token found for post ${fbPostId}`);
    }

    try {
      await postSyncService.syncPostInsights({
        fbPostId,
        facebookPostId: fbPostId,
        accessToken,
        metrics: DEFAULT_POST_METRICS,
        since: options.since,
        until: options.until,
      });
    } catch (error) {
      await this.markPostPageReconnectRequired(fbPostId, error);
      throw error;
    }
  }

  async getPostInsights(
    fbPostId: string,
    options: { since?: string; until?: string } = {}
  ): Promise<PostInsightEntity[]> {
    return resolveInsightCache<PostInsightEntity>({
      entityId: fbPostId,
      options,
      defaultMetrics: DEFAULT_POST_METRICS,
      loadAllFromDb: (postId, query) => postInsightsRepository.getPostInsights(postId, query),
      loadMetricFromDb: (postId, metricName, query) => postInsightsRepository.getPostMetrics(postId, metricName, query),
      resolveAccessToken: async (postId) => {
        const post = await postRepository.getPostByFbPostId(postId);
        const connectedPage = post ? await connectedPageRepository.getPageByFbPageId(post.page_id) : null;
        return resolveStoredToken(connectedPage?.page_token_encrypted);
      },
      fetchMissingFromApi: async (postId, accessToken, metrics, window) => {
        try {
          await postSyncService.syncPostInsights({
            fbPostId: postId,
            facebookPostId: postId,
            accessToken,
            metrics,
            since: window.since,
            until: window.until,
          });
        } catch (error) {
          await this.markPostPageReconnectRequired(postId, error);
          throw error;
        }
      },
    });
  }

  async getPostMetrics(
    fbPostId: string,
    metricName: string,
    options: { since?: string; until?: string } = {}
  ): Promise<PostInsightEntity[]> {
    return resolveInsightCache<PostInsightEntity>({
      entityId: fbPostId,
      options,
      metricName,
      defaultMetrics: DEFAULT_POST_METRICS,
      loadAllFromDb: (postId, query) => postInsightsRepository.getPostInsights(postId, query),
      loadMetricFromDb: (postId, metric, query) => postInsightsRepository.getPostMetrics(postId, metric, query),
      resolveAccessToken: async (postId) => {
        const post = await postRepository.getPostByFbPostId(postId);
        const connectedPage = post ? await connectedPageRepository.getPageByFbPageId(post.page_id) : null;
        return resolveStoredToken(connectedPage?.page_token_encrypted);
      },
      fetchMissingFromApi: async (postId, accessToken, metrics, window) => {
        try {
          await postSyncService.syncPostInsights({
            fbPostId: postId,
            facebookPostId: postId,
            accessToken,
            metrics,
            since: window.since,
            until: window.until,
          });
        } catch (error) {
          await this.markPostPageReconnectRequired(postId, error);
          throw error;
        }
      },
    });
  }
}

export default new PostInsightsService();
