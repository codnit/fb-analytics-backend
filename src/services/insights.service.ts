import type { AxiosResponse } from "axios";
import { BaseGraphClient } from "../core/base.graph-client";
import { Environment } from "../config/environment";
import { InsightsHelper } from "../utils/insights.helpers";
import type {
  FacebookBatchRequest,
  FacebookBatchResponse,
  FacebookInsightsResponse,
  FacebookPost,
  FacebookPostsResponse,
  GraphBatchResult,
} from "../types/facebook";
import type { GraphQueryOptions } from "../types/domain";

type InsightResponse = {
  success: true;
  pageId?: string;
  postId?: string;
  metrics?: string[];
  period?: string;
  data: FacebookInsightsResponse | unknown;
};

export class InsightsService extends BaseGraphClient {
  constructor() {
    super();
  }

  async getPageInsights(pageId: string, metrics: string[], options: GraphQueryOptions = {}): Promise<InsightResponse> {
    try {
      const { access_token, period = "day", since, until, breakdown } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!pageId) throw new Error("Page ID is required");
      if (!metrics || metrics.length === 0) throw new Error("At least one metric is required");

      const params: Record<string, unknown> = {
        access_token,
        metric: metrics.join(","),
        period,
      };

      if (since) params.since = since;
      if (until) params.until = until;
      if (breakdown) params.breakdown = breakdown;

      const response = await this.http.get<FacebookInsightsResponse>(`/${pageId}/insights`, {
        params,
      });

      return {
        success: true,
        pageId,
        metrics,
        period,
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch page insights: ${this.extractMessage(error)}`);
    }
  }

  async getPostInsights(postId: string, metrics: string[], options: GraphQueryOptions = {}): Promise<InsightResponse> {
    try {
      const { access_token, period = "lifetime", since, until } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!postId) throw new Error("Post ID is required");
      if (!metrics || metrics.length === 0) throw new Error("At least one metric is required");

      const params: Record<string, unknown> = {
        access_token,
        metric: metrics.join(","),
        period,
      };

      if (since) params.since = since;
      if (until) params.until = until;

      const response = await this.http.get<FacebookInsightsResponse>(`/${postId}/insights`, { params });

      return {
        success: true,
        postId,
        metrics,
        period,
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch post insights: ${this.extractMessage(error)}`);
    }
  }

  async getPostCommentsCount(postId: string, options: GraphQueryOptions = {}): Promise<{ success: true; postId: string; metric: string; data: unknown }> {
    try {
      const { access_token } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!postId) throw new Error("Post ID is required");

      const response = await this.http.get(`/${postId}`, {
        params: {
          access_token,
          fields: "comments.summary(true)",
        },
      });

      return {
        success: true,
        postId,
        metric: "comments.summary.total_count",
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch post comments count: ${this.extractMessage(error)}`);
    }
  }

  async getPostSharesCount(postId: string, options: GraphQueryOptions = {}): Promise<{ success: true; postId: string; metric: string; data: unknown }> {
    try {
      const { access_token } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!postId) throw new Error("Post ID is required");

      const response = await this.http.get(`/${postId}`, {
        params: {
          access_token,
          fields: "shares",
        },
      });

      return {
        success: true,
        postId,
        metric: "shares.count",
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch post shares count: ${this.extractMessage(error)}`);
    }
  }

  async getUserDetails(options: GraphQueryOptions = {}): Promise<{ success: true; data: unknown }> {
    try {
      const { access_token, fields = "id,name,email,picture" } = options;

      if (!access_token) throw new Error("Access token is required");

      const response = await this.http.get(`/${"me"}`, {
        params: {
          access_token,
          fields,
        },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch user details: ${this.extractMessage(error)}`);
    }
  }

  async getPageDetails(pageId: string, options: GraphQueryOptions = {}): Promise<{ success: true; data: any }> {
    try {
      const { access_token, fields = "id,name,category,picture,fan_count" } = options;
      if (!access_token) throw new Error("Access token is required");

      const response = await this.http.get(`/${pageId}`, {
        params: { access_token, fields },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch page details: ${this.extractMessage(error)}`);
    }
  }

  async getUserPages(options: GraphQueryOptions = {}): Promise<{ success: true; data: unknown[] }> {
    try {
      const { access_token } = options;

      if (!access_token) throw new Error("Access token is required");

      const response = await this.http.get(`/${"me/accounts"}`, {
        params: { 
          access_token,
          fields: "id,name,access_token,category,picture,fan_count"
        },
      });

      return {
        success: true,
        data: Array.isArray(response.data?.data) ? response.data.data : [],
      };
    } catch (error) {
      throw new Error(`Failed to fetch user pages: ${this.extractMessage(error)}`);
    }
  }

  async getPostWithInsights(
    postId: string,
    options: GraphQueryOptions = {}
  ): Promise<{ success: true; data: FacebookPost }> {
    try {
      const { access_token, since, until } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!postId) throw new Error("Post ID is required");

      const formatMetaDate = (value?: string): string | undefined => {
        if (!value) {
          return undefined;
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return value;
        }

        return parsed.toISOString().slice(0, 10);
      };

      const normalizedSince = formatMetaDate(since);
      const normalizedUntil = formatMetaDate(until);

      const fields = [
        "status_type",
        // "message",
        // "type",
        "attachments{media,media_type,type}",
        "comments.summary(true)",
        `insights.metric(content_monetization_earnings,monetization_approximate_earnings).period(lifetime)${normalizedSince ? `.since(${normalizedSince})` : ""}${normalizedUntil ? `.until(${normalizedUntil})` : ""}`,
      ].join(",");

      const response = await this.http.get<FacebookPost>(`/${postId}`, {
        params: {
          access_token,
          fields,
        },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch post details: ${this.extractMessage(error)}`);
    }
  }

  async getPostMetadata(
    postId: string,
    options: GraphQueryOptions = {}
  ): Promise<{ success: true; data: FacebookPost }> {
    try {
      const { access_token } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!postId) throw new Error("Post ID is required");

      const response = await this.http.get<FacebookPost>(`/${postId}`, {
        params: {
          access_token,
          fields: "id,message,created_time,permalink_url,status_type,full_picture,comments.summary(true),shares",
        },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch post metadata: ${this.extractMessage(error)}`);
    }
  }

  async getPagePostsPage(
    pageId: string,
    options: GraphQueryOptions = {}
  ): Promise<{ success: true; data: FacebookPost[]; paging?: FacebookPostsResponse["paging"] }> {
    try {
      const { access_token, limit = 100, since, until, nextPageUrl, after, before } = options;

      let response;

      if (nextPageUrl) {
        response = await this.http.get<FacebookPostsResponse>(nextPageUrl);
      } else {
        if (!access_token) throw new Error("Access token is required");

        const params: Record<string, unknown> = {
          access_token,
          limit,
          fields: "id,message,created_time,permalink_url,status_type,full_picture,comments.limit(0).summary(true),shares",
        };

        if (since) params.since = since;
        if (until) params.until = until;
        if (after) params.after = after;
        if (before) params.before = before;

        response = await this.http.get<FacebookPostsResponse>(`/${pageId}/posts`, {
          params,
        });
      }

      return {
        success: true,
        data: Array.isArray(response.data?.data) ? response.data.data : [],
        paging: response.data?.paging,
      };
    } catch (error) {
      throw new Error(`Failed to fetch page posts: ${this.extractMessage(error)}`);
    }
  }

  async getPagePosts(pageId: string, options: GraphQueryOptions = {}): Promise<{ success: true; data: unknown[] }> {
    try {
      const { access_token, limit = 10, fetchAll = false } = options;

      if (!access_token) throw new Error("Access token is required");

      const firstPage = await this.getPagePostsPage(pageId, {
        ...options,
        access_token,
        limit,
      });

      if (fetchAll) {
        let paging = firstPage.paging;
        const allPosts: unknown[] = [...firstPage.data];

        while (paging && paging.next) {
          const nextPage = await this.getPagePostsPage(pageId, {
            ...options,
            nextPageUrl: paging.next,
          });
          allPosts.push(...nextPage.data);
          paging = nextPage.paging;
        }

        return {
          success: true,
          data: allPosts,
        };
      }

      return {
        success: true,
        data: firstPage.data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch page posts: ${this.extractMessage(error)}`);
    }
  }

  async sendBatchRequest(requests: FacebookBatchRequest[], accessToken: string): Promise<FacebookBatchResponse[]> {
    try {
      const formData = new URLSearchParams();
      formData.append("batch", JSON.stringify(requests));
      formData.append("access_token", accessToken);

      const response = await this.http.post<FacebookBatchResponse[]>("", formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return response.data;
    } catch (error) {
      throw new Error(`Batch request failed: ${this.extractMessage(error)}`);
    }
  }

  private chunkArray<T>(array: T[], chunkSize = 50): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < array.length; index += chunkSize) {
      chunks.push(array.slice(index, index + chunkSize));
    }
    return chunks;
  }

  private parseBatchBody(body: string | Record<string, unknown> | undefined): unknown {
    if (!body) {
      return {};
    }

    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return { raw: body };
      }
    }

    return body;
  }

  async getMultiplePageInsights(pageIds: string[], metrics: string[], options: GraphQueryOptions = {}): Promise<GraphBatchResult[]> {
    try {
      const { access_token, period = "day", since, until } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!pageIds || pageIds.length === 0) throw new Error("At least one page ID is required");
      if (!metrics || metrics.length === 0) throw new Error("At least one metric is required");

      let queryString = `metric=${metrics.join(",")}&period=${period}`;
      if (since) queryString += `&since=${since}`;
      if (until) queryString += `&until=${until}`;

      const pageIdChunks = this.chunkArray(pageIds, 50);
      const allResults: GraphBatchResult[] = [];

      for (const chunk of pageIdChunks) {
        const batchRequests = chunk.map((pageId, index) => ({
          method: "GET" as const,
          relative_url: `${pageId}/insights?${queryString}`,
          name: `page_${pageId}_${index}`,
        }));

        const batchResponses = await this.sendBatchRequest(batchRequests, access_token);

        for (let index = 0; index < batchResponses.length; index += 1) {
          const batchResponse = batchResponses[index];
          const pageId = chunk[index];

          if (batchResponse?.code && batchResponse.code !== 200) {
            allResults.push({
              success: false,
              pageId,
              error: this.parseBatchBody(batchResponse.body),
            });
          } else {
            allResults.push({
              success: true,
              pageId,
              metrics,
              period,
              data: this.parseBatchBody(batchResponse.body),
            });
          }
        }
      }

      return allResults;
    } catch (error) {
      throw new Error(`Failed to fetch multiple page insights: ${this.extractMessage(error)}`);
    }
  }

  async getMultiplePostInsights(postIds: string[], metrics: string[], options: GraphQueryOptions = {}): Promise<GraphBatchResult[]> {
    try {
      const { access_token, since, until } = options;

      if (!access_token) throw new Error("Access token is required");
      if (!postIds || postIds.length === 0) throw new Error("At least one post ID is required");
      if (!metrics || metrics.length === 0) throw new Error("At least one metric is required");

      let queryString = `metric=${metrics.join(",")}`;
      if (since) queryString += `&since=${since}`;
      if (until) queryString += `&until=${until}`;
      const postIdChunks = this.chunkArray(postIds, 50);
      const allResults: GraphBatchResult[] = [];

      for (const chunk of postIdChunks) {
        const batchRequests = chunk.map((postId, index) => ({
          method: "GET" as const,
          relative_url: `${postId}/insights?${queryString}`,
          name: `post_${postId}_${index}`,
        }));

        const batchResponses = await this.sendBatchRequest(batchRequests, access_token);

        for (let index = 0; index < batchResponses.length; index += 1) {
          const batchResponse = batchResponses[index];
          const postId = chunk[index];

          if (batchResponse?.code && batchResponse.code !== 200) {
            allResults.push({
              success: false,
              postId,
              error: this.parseBatchBody(batchResponse.body),
            });
          } else {
            allResults.push({
              success: true,
              postId,
              metrics,
              data: this.parseBatchBody(batchResponse.body),
            });
          }
        }
      }

      return allResults;
    } catch (error) {
      throw new Error(`Failed to fetch multiple post insights: ${this.extractMessage(error)}`);
    }
  }

  getAvailableMetrics(): Record<string, unknown> {
    return {
      pageMetrics: {
        engagement: [
          "page_total_actions",
          "page_engaged_users",
          "page_post_engagements",
          "page_consumptions",
          "page_fan_removes",
          "page_fans",
        ],
        reach: [
          "page_impressions",
          "page_impressions_unique",
          "page_reach",
          "page_reach_by_location",
          "page_reach_by_age_gender",
        ],
        monetization: [
          "content_monetization_earnings",
          "content_monetization_subscriptions",
        ],
        video: [
          "post_video_avg_time_watched",
          "post_video_complete_views_organic",
          "post_video_complete_views_paid",
          "post_video_complete_views_unique_organic",
          "post_video_complete_views_unique_paid",
        ],
      },
      postMetrics: {
        engagement: [
          "post_engaged_users",
          "post_engagement",
          "post_engagements",
          "post_negative_feedback",
          "post_negative_feedback_unique",
          "post_negative_feedback_by_type",
          "post_negative_feedback_by_type_unique",
        ],
        reach: [
          "post_impressions",
          "post_impressions_unique",
          "post_impressions_organic",
          "post_impressions_organic_unique",
          "post_impressions_paid",
          "post_impressions_paid_unique",
        ],
        actions: [
          "post_clicks",
          "post_clicks_by_type",
          "post_video_views",
          "post_video_views_organic",
          "post_video_views_paid",
          "post_video_views_autoplayed",
          "post_video_views_click_to_play",
          "post_video_views_unique",
        ],
      },
    };
  }
}

export default new InsightsService();
