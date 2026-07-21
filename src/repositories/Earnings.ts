import { getDB } from "../config/database";
import { BaseRepository } from "../core/base.repository";
import type {
  CmEarningsPageEntity,
  CmEarningsPostEntity,
  PageEarningsCreateInput,
  PostEarningsCreateInput,
} from "../types/domain";
import { PrismaHelpers } from "../utils/prismaHelpers";
import { validateData } from "../utils/schema";
import { getEarningsStorageWindow } from "../utils/earnings.helpers";

export class EarningsRepository extends BaseRepository<unknown> {
  protected readonly tableName = "cm_earnings_post";

  private get postDelegate() {
    return getDB().cmEarningsPost;
  }

  private get pageDelegate() {
    return getDB().cmEarningsPage;
  }

  protected get delegate() {
    return this.postDelegate;
  }

  private normalizeEarningsInput<T extends PageEarningsCreateInput | PostEarningsCreateInput>(earningsData: T): Record<string, unknown> {
    const normalized = PrismaHelpers.stripUndefined(earningsData) as Record<string, unknown>;

    if (typeof normalized.earnings_amount === "bigint") {
      normalized.earnings_amount = normalized.earnings_amount.toString();
    }

    if (typeof normalized.approximate_earnings === "bigint") {
      normalized.approximate_earnings = normalized.approximate_earnings.toString();
    }

    return normalized;
  }

  async getPostEarnings(postId: string): Promise<CmEarningsPostEntity[]> {
    return PrismaHelpers.normalizeRecords(
      await this.postDelegate.findMany({
        where: { post_id: postId },
      })
    ) as unknown as CmEarningsPostEntity[];
  }

  async createPostEarnings(earningsData: PostEarningsCreateInput): Promise<CmEarningsPostEntity> {
    const validation = validateData("cm_earnings_post", earningsData as unknown as Record<string, unknown>);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    return PrismaHelpers.normalizeRecord(
      await this.postDelegate.create({
        data: this.normalizeEarningsInput(earningsData) as never,
      })
    ) as unknown as CmEarningsPostEntity;
  }

  async getPageEarnings(pageId: string): Promise<CmEarningsPageEntity[]> {
    return PrismaHelpers.normalizeRecords(
      await this.pageDelegate.findMany({
        where: { page_id: pageId },
        orderBy: { end_time: "desc" },
      })
    ) as unknown as CmEarningsPageEntity[];
  }

  async getPageEarningsByPageIdsAndRange(pageIds: string[], start: Date, end: Date): Promise<CmEarningsPageEntity[]> {
    if (pageIds.length === 0) {
      return [];
    }

    return PrismaHelpers.normalizeRecords(
      await this.pageDelegate.findMany({
        where: {
          page_id: { in: pageIds },
          end_time: {
            gte: start,
            lte: end,
          },
        },
        orderBy: [{ end_time: "asc" }, { page_id: "asc" }],
      })
    ) as unknown as CmEarningsPageEntity[];
  }

  async getPageEarningsByPageIdsAndPerformanceRange(
    pageIds: string[],
    since: string | Date,
    until: string | Date
  ): Promise<CmEarningsPageEntity[]> {
    if (pageIds.length === 0) {
      return [];
    }

    const { startInclusive, endExclusive } = getEarningsStorageWindow(since, until);

    return PrismaHelpers.normalizeRecords(
      await this.pageDelegate.findMany({
        where: {
          page_id: { in: pageIds },
          end_time: {
            gte: startInclusive,
            lt: endExclusive,
          },
        },
        orderBy: [{ end_time: "asc" }, { page_id: "asc" }],
      })
    ) as unknown as CmEarningsPageEntity[];
  }

  async getPageEarningsForPerformanceRange(
    pageId: string,
    since: string | Date,
    until: string | Date
  ): Promise<CmEarningsPageEntity[]> {
    return this.getPageEarningsByPageIdsAndPerformanceRange([pageId], since, until);
  }

  async getPageEarningsTotals(pageIds: string[]): Promise<Map<string, number>> {
    if (pageIds.length === 0) {
      return new Map();
    }

    const rows = await this.pageDelegate.groupBy({
      by: ["page_id"],
      where: { page_id: { in: pageIds } },
      _sum: {
        earnings_amount: true,
        approximate_earnings: true,
      },
    });

    return new Map(
      rows.map((row) => [
        row.page_id,
        Number(row._sum.earnings_amount || 0) + Number(row._sum.approximate_earnings || 0),
      ])
    );
  }

  async getPostEarningsByPostIdsAndRange(postIds: string[], start: Date, end: Date): Promise<CmEarningsPostEntity[]> {
    if (postIds.length === 0) {
      return [];
    }

    return PrismaHelpers.normalizeRecords(
      await this.postDelegate.findMany({
        where: {
          post_id: { in: postIds },
          end_time: {
            gte: start,
            lte: end,
          },
        },
        orderBy: [{ end_time: "asc" }, { post_id: "asc" }],
      })
    ) as unknown as CmEarningsPostEntity[];
  }

  async createPageEarnings(earningsData: PageEarningsCreateInput): Promise<CmEarningsPageEntity> {
    const validation = validateData("cm_earnings_page", earningsData as unknown as Record<string, unknown>);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    return PrismaHelpers.normalizeRecord(
      await this.pageDelegate.create({
        data: this.normalizeEarningsInput(earningsData) as never,
      })
    ) as unknown as CmEarningsPageEntity;
  }

  async upsertPostEarnings(earningsData: PostEarningsCreateInput): Promise<CmEarningsPostEntity> {
    return PrismaHelpers.normalizeRecord(
      await PrismaHelpers.upsertByLookup({
        delegate: this.postDelegate,
        where: PrismaHelpers.buildWhere({
          post_id: earningsData.post_id,
          period: earningsData.period,
          end_time: earningsData.end_time,
        }),
        create: this.normalizeEarningsInput(earningsData),
        update: this.normalizeEarningsInput(earningsData),
      })
    ) as unknown as CmEarningsPostEntity;
  }

  async upsertPageEarnings(earningsData: PageEarningsCreateInput): Promise<CmEarningsPageEntity> {
    return PrismaHelpers.normalizeRecord(
      await PrismaHelpers.upsertByLookup({
        delegate: this.pageDelegate,
        where: PrismaHelpers.buildWhere({
          page_id: earningsData.page_id,
          period: earningsData.period,
          end_time: earningsData.end_time,
        }),
        create: this.normalizeEarningsInput(earningsData),
        update: this.normalizeEarningsInput(earningsData),
      })
    ) as unknown as CmEarningsPageEntity;
  }

  /** Incremental sync: check if a page earnings row exists for a given date */
  async findPageEarningsByDate(pageId: string, date: Date): Promise<CmEarningsPageEntity | null> {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);

    return PrismaHelpers.normalizeRecord(
      await this.pageDelegate.findFirst({
        where: { page_id: pageId, end_time: { gte: start, lte: end } },
      })
    ) as unknown as CmEarningsPageEntity | null;
  }

  /** Incremental sync: check if a post earnings row exists for a given date */
  async findPostEarningsByDate(postId: string, date: Date): Promise<CmEarningsPostEntity | null> {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);

    return PrismaHelpers.normalizeRecord(
      await this.postDelegate.findFirst({
        where: { post_id: postId, end_time: { gte: start, lte: end } },
      })
    ) as unknown as CmEarningsPostEntity | null;
  }
}

export default new EarningsRepository();
