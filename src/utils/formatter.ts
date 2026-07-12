import type { AnyRecord } from "../types/domain";
import type { FacebookInsightItem, FacebookInsightsResponse, FacebookUserProfile } from "../types/facebook";

export class ResponseFormatter {
  static formatPageInsights(pageId: string, response: FacebookInsightsResponse | AnyRecord[] | null | undefined): AnyRecord[] {
    try {
      const insights: AnyRecord[] = [];

      if (!response) {
        return insights;
      }

      if ("data" in response && Array.isArray(response.data)) {
        for (const item of response.data) {
          const metricName = item.name || "unknown";
          const period = item.period || "day";
          const values = Array.isArray(item.values) ? item.values : [];

          for (const value of values) {
            insights.push({
              page_id: pageId,
              name: metricName,
              value: value.value ?? null,
              period,
              end_time: value.end_time ?? null,
            });
          }
        }
        return insights;
      }

      if (Array.isArray(response)) {
        for (const item of response) {
          if (typeof item === "object" && item !== null && ("metric_name" in item || "name" in item)) {
            const insight = item as AnyRecord;
            insights.push({
              page_id: pageId,
              name: insight.name || insight.metric_name || "unknown",
              value: insight.value !== undefined ? insight.value : insight.metric_value ?? null,
              period: insight.period ?? "day",
              end_time: insight.end_time ?? null,
            });
          }
        }
      }

      return insights;
    } catch (error) {
      console.error("Error formatting page insights:", error);
      return [];
    }
  }

  static formatPostInsights(postId: string, response: FacebookInsightsResponse | AnyRecord[] | null | undefined): AnyRecord[] {
    try {
      const insights: AnyRecord[] = [];

      if (!response) {
        return insights;
      }

      if ("data" in response && Array.isArray(response.data)) {
        for (const item of response.data) {
          const metricName = item.name || "unknown";
          const values = Array.isArray(item.values) ? item.values : [];

          for (const value of values) {
            insights.push({
              post_id: postId,
              name: metricName,
              value: value.value ?? null,
              period: item.period ?? null,
              end_time: value.end_time ?? null,
            });
          }
        }
        return insights;
      }

      if (Array.isArray(response)) {
        for (const item of response) {
          if (typeof item === "object" && item !== null && ("metric_name" in item || "name" in item)) {
            const insight = item as AnyRecord;
            insights.push({
              post_id: postId,
              name: insight.name || insight.metric_name || "unknown",
              value: insight.value !== undefined ? insight.value : insight.metric_value ?? null,
              period: insight.period ?? null,
              end_time: insight.end_time ?? null,
            });
          }
        }
      }

      return insights;
    } catch (error) {
      console.error("Error formatting post insights:", error);
      return [];
    }
  }

  static formatUserDetails(metaResponse: FacebookUserProfile | AnyRecord | null | undefined): AnyRecord {
    try {
      if (!metaResponse) {
        return {};
      }

      return {
        fb_user_id: (metaResponse as FacebookUserProfile).id || null,
        name: (metaResponse as FacebookUserProfile).name || null,
        email: (metaResponse as FacebookUserProfile).email || null,
        picture_url: (metaResponse as FacebookUserProfile).picture?.data?.url || null,
      };
    } catch (error) {
      console.error("Error formatting user details:", error);
      return {};
    }
  }

  static formatCommentsCount(postId: string, metaResponse: AnyRecord | null | undefined): AnyRecord {
    try {
      if (!metaResponse) {
        return {
          post_id: postId,
          metric_name: "comments.summary.total_count",
          metric_value: 0,
        };
      }

      const comments = metaResponse.comments as AnyRecord | undefined;
      const summary = comments?.summary as AnyRecord | undefined;

      return {
        post_id: postId,
        metric_name: "comments.summary.total_count",
        metric_value: summary?.total_count || 0,
      };
    } catch (error) {
      console.error("Error formatting comments count:", error);
      return {
        post_id: postId,
        metric_name: "comments.summary.total_count",
        metric_value: 0,
      };
    }
  }

  static formatSharesCount(postId: string, metaResponse: AnyRecord | null | undefined): AnyRecord {
    try {
      if (!metaResponse) {
        return {
          post_id: postId,
          metric_name: "shares.count",
          metric_value: 0,
        };
      }

      const shares = metaResponse.shares as AnyRecord | undefined;

      return {
        post_id: postId,
        metric_name: "shares.count",
        metric_value: shares?.count || 0,
      };
    } catch (error) {
      console.error("Error formatting shares count:", error);
      return {
        post_id: postId,
        metric_name: "shares.count",
        metric_value: 0,
      };
    }
  }

  static formatConnectedPage(partnerId: string, response: AnyRecord | null | undefined): AnyRecord {
    try {
      if (!response) {
        return {};
      }

      return {
        partner_id: partnerId,
        fb_page_id: response.fb_page_id || response.id || null,
        page_name: response.name || response.page_name || null,
        page_token_encrypted: response.page_token_encrypted || null,
        publishing_enabled: Boolean(response.publishing_enabled),
        publishing_granted_at: response.publishing_granted_at || null,
        publishing_granted_by: response.publishing_granted_by || null,
        facebook_permissions: response.facebook_permissions || null,
        permissions_checked_at: response.permissions_checked_at || null,
        picture_url: response.picture_url || (response.picture as any)?.data?.url || null,
        category: response.category || null,
        fan_count: response.fan_count ? Number(response.fan_count) : 0,
        is_active: response.is_active !== undefined ? response.is_active : true,
        last_synced_at: response.last_synced_at || null,
        latest_sync_completed_at: response.latest_sync_completed_at || null,
      };
    } catch (error) {
      console.error("Error formatting connected page:", error);
      return { partner_id: partnerId };
    }
  }

  static formatPartner(response: AnyRecord | null | undefined): AnyRecord {
    try {
      if (!response) {
        return {};
      }

      return {
        partner_id: response.id || null,
        user_id: response.user_id || null,
        name: response.name || null,
        email: response.email || null,
        phone: response.phone || null,
        country: response.country || null,
        company: response.company || null,
        publisher_type: response.publisher_type || null,
        website_url: response.website_url || null,
        niche_category: response.niche_category || null,
        reason_joining: response.reason_joining || null,
        created_at: response.created_at || null,
      };
    } catch (error) {
      console.error("Error formatting partner:", error);
      return {};
    }
  }

  static formatPost(pageId: string, response: AnyRecord | null | undefined): AnyRecord {
    try {
      if (!response) {
        return {};
      }

      return {
        page_id: pageId,
        fb_post_id: response.fb_post_id || response.id || null,
        message: response.message || null,
        type: response.type || response.status_type || null,
        full_picture: response.full_picture || (response as any).full_picture || null,
        comments_count: response.comments_count || (response.comments as any)?.summary?.total_count || 0,
        shares_count: response.shares_count || (response.shares as any)?.count || 0,
        permalink: response.permalink || response.permalink_url || null,
        created_time: response.created_time || null,
      };
    } catch (error) {
      console.error("Error formatting post:", error);
      return { page_id: pageId };
    }
  }

  static formatInsightsResponse(data: FacebookInsightsResponse | null | undefined): { data: FacebookInsightItem[] } {
    if (!data || !Array.isArray(data.data)) {
      return { data: [] };
    }

    return {
      data: data.data.map((item) => ({
        name: item.name,
        values: item.values,
        period: item.period,
        title: item.title,
        description: item.description,
      })),
    };
  }

  static getNestedValue(obj: AnyRecord, path: string): unknown {
    try {
      return path.split(".").reduce<unknown>((current, part) => {
        if (current === null || current === undefined) {
          return null;
        }

        if (typeof current === "object" && part.match(/^\d+$/)) {
          return (current as unknown[])[Number.parseInt(part, 10)];
        }

        return (current as AnyRecord)[part];
      }, obj);
    } catch {
      return null;
    }
  }
}

export const formatPageInsights = ResponseFormatter.formatPageInsights;
export const formatPostInsights = ResponseFormatter.formatPostInsights;
export const formatUserDetails = ResponseFormatter.formatUserDetails;
export const formatCommentsCount = ResponseFormatter.formatCommentsCount;
export const formatSharesCount = ResponseFormatter.formatSharesCount;
export const formatConnectedPage = ResponseFormatter.formatConnectedPage;
export const formatPartner = ResponseFormatter.formatPartner;
export const formatPost = ResponseFormatter.formatPost;
export const getNestedValue = ResponseFormatter.getNestedValue;
