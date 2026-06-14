export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface AnyRecord {
  [key: string]: unknown;
}

export interface BaseEntity {
  id: string;
}

export interface PartnerEntity extends BaseEntity {
  user_id: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  created_at: Date;
}

export interface ConnectedPageEntity extends BaseEntity {
  partner_id: string;
  fb_page_id: string;
  page_name?: string | null;
  page_token_encrypted?: string | null;
  picture_url?: string | null;
  category?: string | null;
  fan_count: bigint | number | string;
  is_active: boolean;
  last_synced_at?: Date | null;
  latest_sync_completed_at?: Date | null;
  created_at: Date;
}

export interface PostEntity extends BaseEntity {
  page_id: string;
  fb_post_id: string;
  message?: string | null;
  type?: string | null;
  full_picture?: string | null;
  comments_count?: number | null;
  shares_count?: number | null;
  permalink?: string | null;
  created_time?: Date | null;
  synced_at: Date;
}

export interface PageInsightEntity extends BaseEntity {
  page_id: string;
  metric_name: string;
  metric_value?: JsonValue | null;
  period?: string | null;
  end_time?: Date | null;
  synced_at: Date;
}

export interface PostInsightEntity extends BaseEntity {
  post_id: string;
  metric_name: string;
  metric_value?: JsonValue | null;
  period?: string | null;
  end_time?: Date | null;
  synced_at: Date;
}

export interface CmEarningsPostEntity extends BaseEntity {
  post_id: string;
  earnings_amount: bigint | number | string;
  approximate_earnings: bigint | number | string;
  currency: string;
  period?: string | null;
  end_time?: Date | null;
  synced_at: Date;
}

export interface CmEarningsPageEntity extends BaseEntity {
  page_id: string;
  earnings_amount: bigint | number | string;
  approximate_earnings: bigint | number | string;
  content_type_breakdown?: JsonValue | null;
  currency: string;
  period?: string | null;
  end_time?: Date | null;
  synced_at: Date;
}

export interface ThirdPartyDataEntity extends BaseEntity {
  page_id?: string | null;
  post_id?: string | null;
  data_type: string;
  value?: JsonValue | null;
  synced_at: Date;
}

export type SyncJobStatus = "pending" | "running" | "completed" | "failed";

export interface SyncJobEntity extends BaseEntity {
  page_id: string;
  job_type: string;
  status: SyncJobStatus | string;
  started_at?: Date | null;
  completed_at?: Date | null;
  error_log?: string | null;
  created_at: Date;
}

export interface PartnerCreateInput {
  user_id: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

export interface ConnectedPageCreateInput {
  partner_id: string;
  fb_page_id: string;
  page_name?: string | null;
  page_token_encrypted?: string | null;
  picture_url?: string | null;
  category?: string | null;
  fan_count?: bigint | number | string;
  is_active?: boolean;
  last_synced_at?: Date | null;
}

export interface PostCreateInput {
  page_id: string;
  fb_post_id: string;
  message?: string | null;
  type?: string | null;
  full_picture?: string | null;
  comments_count?: number | null;
  shares_count?: number | null;
  permalink?: string | null;
  created_time?: Date | null;
  synced_at?: Date;
}

export interface PageInsightCreateInput {
  page_id: string;
  metric_name: string;
  metric_value?: JsonValue | null;
  period?: string | null;
  end_time?: Date | null;
  synced_at?: Date;
}

export interface PostInsightCreateInput {
  post_id: string;
  metric_name: string;
  metric_value?: JsonValue | null;
  period?: string | null;
  end_time?: Date | null;
  synced_at?: Date;
}

export interface PageEarningsCreateInput {
  page_id: string;
  earnings_amount?: bigint | number | string;
  approximate_earnings?: bigint | number | string;
  content_type_breakdown?: JsonValue | null;
  currency?: string;
  period?: string | null;
  end_time?: Date | null;
  synced_at?: Date;
}

export interface PostEarningsCreateInput {
  post_id: string;
  earnings_amount?: bigint | number | string;
  approximate_earnings?: bigint | number | string;
  currency?: string;
  period?: string | null;
  end_time?: Date | null;
  synced_at?: Date;
}

export interface ThirdPartyDataCreateInput {
  page_id?: string | null;
  post_id?: string | null;
  data_type: string;
  value?: JsonValue | null;
  synced_at?: Date;
}

export interface SyncJobCreateInput {
  page_id: string;
  job_type: string;
  status?: SyncJobStatus | string;
  started_at?: Date | null;
  completed_at?: Date | null;
  error_log?: string | null;
  created_at?: Date;
}

export interface GraphQueryOptions {
  access_token?: string;
  fields?: string;
  period?: string;
  since?: string;
  until?: string;
  limit?: number;
  after?: string;
  before?: string;
  fetchAll?: boolean;
  nextPageUrl?: string;
  breakdown?: string;
}
