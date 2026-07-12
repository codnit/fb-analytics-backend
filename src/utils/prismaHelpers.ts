import type { AnyRecord } from "../types/domain";

const isDecimalLike = (value: unknown): boolean => {
  return Boolean(value) && typeof value === "object" && "constructor" in (value as object) && (value as { constructor?: { name?: string } }).constructor?.name === "Decimal";
};

const normalizeValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value;
  }

  if (isDecimalLike(value)) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, normalizeValue(nestedValue)])
    );
  }

  return value;
};

export class PrismaHelpers {
  static normalizeValue(value: unknown): unknown {
    return normalizeValue(value);
  }

  static normalizeRecord<T = unknown>(record: T): T {
    return normalizeValue(record) as T;
  }

  static normalizeRecords<T = unknown>(records: T[] | T): T[] | T {
    if (!Array.isArray(records)) {
      return this.normalizeRecord(records);
    }

    return records.map((record) => this.normalizeRecord(record));
  }

  static stripUndefined<T>(data: T): T {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return data;
    }

    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).filter(([, value]) => value !== undefined)
    ) as T;
  }

  static buildWhere(criteria: AnyRecord = {}): AnyRecord {
    return this.stripUndefined(criteria);
  }

  static async upsertByLookup<T>({
    delegate,
    where,
    create,
    update,
  }: {
    delegate: {
      findFirst: (args: { where: AnyRecord }) => Promise<T | null>;
      create: (args: { data: AnyRecord }) => Promise<T>;
      update: (args: { where: AnyRecord; data: AnyRecord }) => Promise<T>;
    };
    where: AnyRecord;
    create: AnyRecord;
    update?: AnyRecord;
  }): Promise<T> {
    const existing = await delegate.findFirst({ where });

    if (existing) {
      const updatePayload = this.stripUndefined(update || create) as AnyRecord;

      if (!updatePayload || Object.keys(updatePayload).length === 0) {
        return existing;
      }

      return delegate.update({
        where: { id: (existing as { id?: string }).id },
        data: updatePayload,
      });
    }

    return delegate.create({
      data: this.stripUndefined(create),
    });
  }

  static getTableDelegate(db: Record<string, unknown>, tableName: string): unknown {
    const tableMap: Record<string, string> = {
      partners: "partner",
      connected_pages: "connectedPage",
      posts: "post",
      page_insights: "pageInsight",
      post_insights: "postInsight",
      cm_earnings_post: "cmEarningsPost",
      cm_earnings_page: "cmEarningsPage",
      third_party_data: "thirdPartyData",
      sync_jobs: "syncJob",
      notifications: "notification",
    };

    const delegateName = tableMap[tableName];

    if (!delegateName || !(delegateName in db)) {
      throw new Error(`Prisma delegate for table '${tableName}' not found`);
    }

    return db[delegateName];
  }
}

export const normalizeRecord = PrismaHelpers.normalizeRecord;
export const normalizeRecords = PrismaHelpers.normalizeRecords;
export const stripUndefined = PrismaHelpers.stripUndefined;
export const buildWhere = PrismaHelpers.buildWhere;
export const upsertByLookup = PrismaHelpers.upsertByLookup;
export const getTableDelegate = PrismaHelpers.getTableDelegate;
