import type { FacebookPost } from "../types/facebook";
import { dumpApiData } from "./debug.helpers";

export const EARNINGS_METRICS = ["content_monetization_earnings", "monetization_approximate_earnings"];

const EARNINGS_DAY_MS = 24 * 60 * 60 * 1000;

const toUtcDayStart = (value: string | Date): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid earnings date: ${String(value)}`);
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

/**
 * Meta daily earnings use the following day's end_time as the storage key.
 * A requested performance window [since, until) therefore maps to stored
 * end_time values in [since + 1 day, until + 1 day).
 */
export const getEarningsStorageWindow = (
  since: string | Date,
  until: string | Date
): { startInclusive: Date; endExclusive: Date } => {
  const performanceStart = toUtcDayStart(since);
  const performanceEnd = toUtcDayStart(until);

  if (performanceEnd < performanceStart) {
    throw new Error("Earnings until date must not be earlier than since date");
  }

  return {
    startInclusive: new Date(performanceStart.getTime() + EARNINGS_DAY_MS),
    endExclusive: new Date(performanceEnd.getTime() + EARNINGS_DAY_MS),
  };
};

export const getExpectedEarningsDayCount = (since: string | Date, until: string | Date): number => {
  const performanceStart = toUtcDayStart(since);
  const performanceEnd = toUtcDayStart(until);
  return Math.max(0, Math.round((performanceEnd.getTime() - performanceStart.getTime()) / EARNINGS_DAY_MS));
};

export type EarningsInsightValue = {
  currency?: string;
  microAmount?: number | string | bigint;
};

export type EarningsInsightEntry = {
  name: string;
  period?: string;
  values?: Array<{
    value?: EarningsInsightValue | number | string;
    end_time?: string;
    earning_source?: string;
  }>;
};

export type DailyEarningsRow = {
  end_time: Date | null;
  period: string | null;
  earnings_amount: number;
  approximate_earnings: number;
  currency: string;
};

export type ContentTypeBreakdownKey = "video" | "photo" | "link" | "text" | "other" | "reel" | "story" | "extra_bonus";

export type ContentTypeBreakdown = Record<
  ContentTypeBreakdownKey,
  {
    earnings_amount: number;
    approximate_earnings: number;
    post_count: number;
  }
>;

export const createEmptyContentTypeBreakdown = (): ContentTypeBreakdown => ({
  video: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  photo: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  link: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  text: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  other: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  reel: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  story: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
  extra_bonus: { earnings_amount: 0, approximate_earnings: 0, post_count: 0 },
});

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
      const periodStr = entry.period || "day";

      let endTime: Date | null = null;
      if (value.end_time) {
        endTime = new Date(value.end_time);
        if (Number.isNaN(endTime.getTime())) {
          continue;
        }
      } else if (periodStr !== "lifetime") {
        continue;
      }

      const key = endTime ? `${endTime.toISOString()}_${periodStr}` : `no_date_${periodStr}`;
      const rowCurrency = typeof value.value === "object" && value.value !== null && "currency" in value.value
        ? (value.value as EarningsInsightValue).currency
        : "USD";

      const row = rows.get(key) || {
        end_time: endTime,
        period: entry.period || null,
        earnings_amount: 0,
        approximate_earnings: 0,
        currency: rowCurrency || "USD",
      };

      if (entry.name === "content_monetization_earnings") {
        row.earnings_amount = extractMicroAmount(value.value);
      }

      if (entry.name === "monetization_approximate_earnings") {
        row.approximate_earnings = extractMicroAmount(value.value);
      }

      row.period = entry.period || row.period;
      if (rowCurrency) row.currency = rowCurrency;
      rows.set(key, row);
    }
  }

  return Array.from(rows.values()).sort((left, right) => {
    const leftTime = left.end_time ? left.end_time.getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.end_time ? right.end_time.getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
};

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

export const getContentTypeFromEarningSource = (source: string): ContentTypeBreakdownKey => {
  switch (source.toLowerCase()) {
    case "image":
    case "photo":
      return "photo";
    case "text":
      return "text";
    case "video":
      return "video";
    case "story":
      return "story";
    case "reel":
    case "reels":
      return "reel";
    case "extra_bonus":
      return "extra_bonus";
    case "link":
      return "link";
    default:
      return "other";
  }
};

export const buildContentTypeBreakdownFromInsights = (
  insightsData: { data?: EarningsInsightEntry[] }
): Map<string, ContentTypeBreakdown> => {
  const breakdownByDate = new Map<string, ContentTypeBreakdown>();

  for (const entry of insightsData.data || []) {
    for (const value of entry.values || []) {
      const periodStr = entry.period || "day";

      let endTime: Date | null = null;
      if (value.end_time) {
        endTime = new Date(value.end_time);
        if (Number.isNaN(endTime.getTime())) {
          continue;
        }
      } else if (periodStr !== "lifetime") {
        continue;
      }

      const key = endTime ? `${endTime.toISOString()}_${periodStr}` : `no_date_${periodStr}`;
      const breakdown = breakdownByDate.get(key) || createEmptyContentTypeBreakdown();

      if (!value.earning_source) {
        continue;
      }

      const contentType = getContentTypeFromEarningSource(value.earning_source);

      if (entry.name === "content_monetization_earnings") {
        breakdown[contentType].earnings_amount += extractMicroAmount(value);
      }

      if (entry.name === "monetization_approximate_earnings") {
        breakdown[contentType].approximate_earnings += extractMicroAmount(value);
      }

      breakdownByDate.set(key, breakdown);
    }
  }

  return breakdownByDate;
};
