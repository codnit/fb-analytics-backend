import type { FacebookPost } from "../types/facebook";

export const EARNINGS_METRICS = ["content_monetization_earnings", "monetization_approximate_earnings"];

export type EarningsInsightValue = {
  currency?: string;
  microAmount?: number | string | bigint;
};

export type EarningsInsightEntry = {
  name: string;
  period?: string;
  values?: Array<{
    value?: EarningsInsightValue;
    end_time?: string;
  }>;
};

export type DailyEarningsRow = {
  end_time: Date;
  period: string | null;
  earnings_amount: number;
  approximate_earnings: number;
  currency: string;
};

export type ContentTypeBreakdownKey = "video" | "photo" | "link" | "text" | "other";

export type ContentTypeBreakdown = Record<
  ContentTypeBreakdownKey,
  {
    earnings_amount: number;
    approximate_earnings: number;
    post_count: number;
  }
>;

export type EarningsPostSource = {
  id?: string;
  fb_post_id?: string;
};

export type PostWithInsightsFetcher = (
  postId: string,
  options: { access_token: string; since?: string; until?: string }
) => Promise<{ success: boolean; data?: FacebookPost }>;

export const extractMicroAmount = (value?: any): number => {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (value.microAmount !== undefined && value.microAmount !== null) {
    if (typeof value.microAmount === "number") {
      return value.microAmount / 100_000_000;
    }
    if (typeof value.microAmount === "bigint") {
      return Number(value.microAmount) / 100_000_000;
    }
    const parsed = Number(value.microAmount);
    return Number.isNaN(parsed) ? 0 : parsed / 100_000_000;
  }

  if (value.value !== undefined && value.value !== null) {
    if (typeof value.value === "number") {
      return value.value;
    }
    const parsed = Number(value.value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

export const buildDailyEarningsRows = (insightsData: { data?: EarningsInsightEntry[] }): DailyEarningsRow[] => {
  const rows = new Map<string, DailyEarningsRow>();

  for (const entry of insightsData.data || []) {
    for (const value of entry.values || []) {
      if (!value.end_time) {
        continue;
      }

      const endTime = new Date(value.end_time);
      if (Number.isNaN(endTime.getTime())) {
        continue;
      }

      const periodStr = entry.period || "day";
      const key = `${endTime.toISOString()}_${periodStr}`;
      const row = rows.get(key) || {
        end_time: endTime,
        period: entry.period || null,
        earnings_amount: 0,
        approximate_earnings: 0,
        currency: value.value?.currency || "USD",
      };

      if (entry.name === "content_monetization_earnings") {
        row.earnings_amount = extractMicroAmount(value.value);
      }

      if (entry.name === "monetization_approximate_earnings") {
        row.approximate_earnings = extractMicroAmount(value.value);
      }

      row.period = entry.period || row.period;
      row.currency = value.value?.currency || row.currency;
      rows.set(key, row);
    }
  }

  return Array.from(rows.values()).sort((left, right) => left.end_time.getTime() - right.end_time.getTime());
};

export const createEmptyContentTypeBreakdown = (): ContentTypeBreakdown => ({
  video: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  photo: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  link: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  text: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  other: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
});

export const getPostContentType = (post: FacebookPost): ContentTypeBreakdownKey => {
  const attachment = post.attachments?.data?.[0];
  const mediaType = attachment?.media_type?.toLowerCase();

  if (mediaType === "video" || mediaType === "photo" || mediaType === "link") {
    return mediaType;
  }

  const attachmentType = attachment?.type?.toLowerCase() || "";
  if (attachmentType.includes("video")) return "video";
  if (attachmentType.includes("photo")) return "photo";
  if (attachmentType.includes("link")) return "link";

  const statusType = post.status_type?.toLowerCase() || "";
  if (statusType.includes("video")) return "video";
  if (statusType.includes("link")) return "link";
  if (statusType.includes("photo")) return "photo";

  if (post.message && post.message.trim()) {
    return "text";
  }

  return "other";
};

export const buildContentTypeBreakdown = async (
  posts: EarningsPostSource[],
  accessToken: string,
  since: string,
  until: string,
  fetchPostWithInsights: PostWithInsightsFetcher
): Promise<Map<string, ContentTypeBreakdown>> => {
  const breakdownByDate = new Map<string, ContentTypeBreakdown>();
  const pagePosts = posts.filter((post): post is EarningsPostSource => Boolean(post?.id || post?.fb_post_id));

  for (const post of pagePosts) {
    const postId = post.fb_post_id || post.id;
    if (!postId) {
      continue;
    }

    const postResponse = await fetchPostWithInsights(postId, {
      access_token: accessToken,
      since,
      until,
    });

    if (!postResponse.success || !postResponse.data) {
      continue;
    }

    const contentType = getPostContentType(postResponse.data);
    const postRows = buildDailyEarningsRows((postResponse.data as { insights?: { data?: EarningsInsightEntry[] } }).insights || {});

    if (postRows.length === 0) {
      continue;
    }

    for (const row of postRows) {
      const key = `${row.end_time.toISOString()}_${row.period || "day"}`;
      const breakdown = breakdownByDate.get(key) || createEmptyContentTypeBreakdown();

      breakdown[contentType].earnings_amount += row.earnings_amount;
      breakdown[contentType].approximate_earnings += row.approximate_earnings;
      breakdown[contentType].post_count += 1;

      breakdownByDate.set(key, breakdown);
    }
  }

  return breakdownByDate;
};
