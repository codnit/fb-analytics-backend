import { decryptPageToken } from "./pageTokenCrypto";

export type InsightQueryOptions = {
  since?: string;
  until?: string;
};

export type DateWindow = {
  since: string;
  until: string;
};

export type CoverageBounds = {
  earliest: Date;
  latest: Date;
};

export type InsightEntityWithEndTime = {
  end_time?: Date | null;
};

export type ResolveInsightCacheParams<TEntity extends InsightEntityWithEndTime> = {
  entityId: string;
  options?: InsightQueryOptions;
  defaultMetrics: string[];
  metricName?: string;
  loadAllFromDb: (entityId: string, options: InsightQueryOptions) => Promise<TEntity[]>;
  loadMetricFromDb: (entityId: string, metricName: string, options: InsightQueryOptions) => Promise<TEntity[]>;
  fetchMissingFromApi: (
    entityId: string,
    accessToken: string,
    metrics: string[],
    window: DateWindow
  ) => Promise<void>;
  resolveAccessToken: (entityId: string) => Promise<string | null>;
};

export const toDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const shiftDays = (date: Date, days: number): Date => {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
};

export const getCoverageBounds = <TEntity extends InsightEntityWithEndTime>(
  items: TEntity[]
): CoverageBounds | null => {
  const dates = items
    .map((item) => item.end_time)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));

  if (dates.length === 0) {
    return null;
  }

  return {
    earliest: new Date(Math.min(...dates.map((date) => date.getTime()))),
    latest: new Date(Math.max(...dates.map((date) => date.getTime()))),
  };
};

export const getStoredInsightWindow = (since: Date, until: Date): { since: Date; until: Date } => {
  const storedSince = shiftDays(since, 1);
  return {
    since: storedSince,
    until: until < storedSince ? storedSince : until,
  };
};

const CHUNK_DAYS = 7; // tune this — smaller = more frequent UI updates, more API calls

const splitIntoChunks = (since: Date, until: Date): DateWindow[] => {
  const chunks: DateWindow[] = [];
  let chunkStart = since;

  while (chunkStart < until) {
    const chunkEnd = new Date(
      Math.min(shiftDays(chunkStart, CHUNK_DAYS).getTime(), until.getTime())
    );
    chunks.push({
      since: chunkStart.toISOString(),
      until: chunkEnd.toISOString(),
    });
    chunkStart = chunkEnd;
  }

  return chunks;
};

export const getMissingWindows = (
  requestedSince: Date,
  requestedUntil: Date,
  coverage: CoverageBounds | null
): DateWindow[] => {
  if (!coverage) {
    return splitIntoChunks(requestedSince, requestedUntil);
  }

  const windows: DateWindow[] = [];
  const prefixUntil = shiftDays(coverage.earliest, -1);
  const suffixSince = shiftDays(coverage.latest, 1);

  if (requestedSince < coverage.earliest && requestedSince <= prefixUntil) {
    const prefixEnd = new Date(Math.min(prefixUntil.getTime(), requestedUntil.getTime()));
    windows.push(...splitIntoChunks(requestedSince, prefixEnd));
  }

  if (requestedUntil > coverage.latest && suffixSince <= requestedUntil) {
    const suffixStart = new Date(Math.max(suffixSince.getTime(), requestedSince.getTime()));
    windows.push(...splitIntoChunks(suffixStart, requestedUntil));
  }

  return windows;
};

// export const getMissingWindows = (
//   requestedSince: Date,
//   requestedUntil: Date,
//   coverage: CoverageBounds | null
// ): DateWindow[] => {
//   if (!coverage) {
//     return [{ since: requestedSince.toISOString(), until: requestedUntil.toISOString() }];
//   }

//   const windows: DateWindow[] = [];
//   const prefixUntil = shiftDays(coverage.earliest, -1);
//   const suffixSince = shiftDays(coverage.latest, 1);

//   if (requestedSince < coverage.earliest && requestedSince <= prefixUntil) {
//     windows.push({
//       since: requestedSince.toISOString(),
//       until: new Date(Math.min(prefixUntil.getTime(), requestedUntil.getTime())).toISOString(),
//     });
//   }

//   if (requestedUntil > coverage.latest && suffixSince <= requestedUntil) {
//     windows.push({
//       since: new Date(Math.max(suffixSince.getTime(), requestedSince.getTime())).toISOString(),
//       until: requestedUntil.toISOString(),
//     });
//   }

//   return windows;
// };

export const resolveStoredToken = (storedToken?: string | null): string | null => {
  if (!storedToken) {
    return null;
  }

  try {
    return decryptPageToken(storedToken);
  } catch {
    return storedToken;
  }
};

export const resolveInsightCache = async <TEntity extends InsightEntityWithEndTime>(
  params: ResolveInsightCacheParams<TEntity>
): Promise<TEntity[]> => {
  const requestedSince = toDate(params.options?.since);
  const requestedUntil = toDate(params.options?.until);

  if (!requestedSince || !requestedUntil) {
    return params.metricName
      ? params.loadMetricFromDb(params.entityId, params.metricName, params.options || {})
      : params.loadAllFromDb(params.entityId, params.options || {});
  }

  const storedWindow = getStoredInsightWindow(requestedSince, requestedUntil);
  const dbOptions = {
    since: storedWindow.since.toISOString(),
    until: storedWindow.until.toISOString(),
  };

  const existing = params.metricName
    ? await params.loadMetricFromDb(params.entityId, params.metricName, dbOptions)
    : await params.loadAllFromDb(params.entityId, dbOptions);

  const coverage = getCoverageBounds(existing);
  const missingWindows = getMissingWindows(storedWindow.since, storedWindow.until, coverage);

  if (missingWindows.length === 0) {
    return existing;
  }

  const accessToken = await params.resolveAccessToken(params.entityId);

  if (!accessToken) {
    throw new Error(`No stored token found for ${params.entityId}`);
  }

  const metrics = params.metricName ? [params.metricName] : params.defaultMetrics;

  for (const window of missingWindows) {
    await params.fetchMissingFromApi(params.entityId, accessToken, metrics, {
      since: shiftDays(new Date(window.since), -1).toISOString(),
      until: window.until,
    });
  }

  return params.metricName
    ? params.loadMetricFromDb(params.entityId, params.metricName, dbOptions)
    : params.loadAllFromDb(params.entityId, dbOptions);
};
