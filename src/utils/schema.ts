import type { AnyRecord } from "../types/domain";

type TableFieldSchema = {
  type: string;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
};

type TableSchema = {
  required: string[];
  fields: Record<string, TableFieldSchema>;
};

export class SchemaRegistry {
  static readonly dbSchema: Record<string, TableSchema> = {
    partners: {
      required: ["user_id"],
      fields: {
        user_id: { type: "text", required: true, unique: true },
        name: { type: "text", required: false, default: null },
        email: { type: "text", required: false, default: null },
        company: { type: "text", required: false, default: null },
      },
    },
    connected_pages: {
      required: ["partner_id", "fb_page_id"],
      fields: {
        partner_id: { type: "uuid", required: true },
        fb_page_id: { type: "text", required: true },
        page_name: { type: "text", required: false, default: null },
        page_token_encrypted: { type: "text", required: false, default: null },
        publishing_enabled: { type: "boolean", required: false, default: false },
        publishing_granted_at: { type: "timestamptz", required: false, default: null },
        publishing_granted_by: { type: "text", required: false, default: null },
        facebook_permissions: { type: "jsonb", required: false, default: null },
        permissions_checked_at: { type: "timestamptz", required: false, default: null },
        fan_count: { type: "bigint", required: false, default: 0 },
        is_active: { type: "boolean", required: false, default: true },
        last_synced_at: { type: "timestamptz", required: false, default: null },
      },
    },
    publishing_posts: {
      required: ["page_id", "fb_page_id", "post_type"],
      fields: {
        page_id: { type: "uuid", required: true },
        fb_page_id: { type: "text", required: true },
        fb_post_id: { type: "text", required: false, default: null },
        permalink: { type: "text", required: false, default: null },
        post_type: { type: "text", required: true },
        message: { type: "text", required: false, default: null },
        link: { type: "text", required: false, default: null },
        media_url: { type: "text", required: false, default: null },
        media_object_key: { type: "text", required: false, default: null },
        scheduled_publish_time: { type: "timestamptz", required: false, default: null },
        status: { type: "text", required: false, default: "pending" },
        graph_response: { type: "jsonb", required: false, default: null },
        error_message: { type: "text", required: false, default: null },
        attempt_count: { type: "integer", required: false, default: 0 },
        last_attempt_at: { type: "timestamptz", required: false, default: null },
        next_retry_at: { type: "timestamptz", required: false, default: null },
        created_by: { type: "text", required: false, default: null },
        created_via: { type: "text", required: false, default: "api" },
      },
    },
    notifications: {
      required: ["recipient_partner_id", "connected_page_id", "publishing_post_id", "title"],
      fields: {
        recipient_partner_id: { type: "uuid", required: true },
        connected_page_id: { type: "uuid", required: true },
        publishing_post_id: { type: "uuid", required: true },
        type: { type: "text", required: false, default: "facebook_post_published" },
        title: { type: "text", required: true },
        message: { type: "text", required: false, default: null },
        page_name: { type: "text", required: false, default: null },
        post_url: { type: "text", required: false, default: null },
        is_read: { type: "boolean", required: false, default: false },
        read_at: { type: "timestamptz", required: false, default: null },
      },
    },
    posts: {
      required: ["page_id", "fb_post_id"],
      fields: {
        page_id: { type: "text", required: true },
        fb_post_id: { type: "text", required: true },
        message: { type: "text", required: false, default: null },
        type: { type: "text", required: false, default: null },
        permalink: { type: "text", required: false, default: null },
        created_time: { type: "timestamptz", required: false, default: null },
      },
    },
    page_insights: {
      required: ["page_id", "metric_name"],
      fields: {
        page_id: { type: "text", required: true },
        metric_name: { type: "text", required: true },
        metric_value: { type: "jsonb", required: false, default: null },
        period: { type: "text", required: false, default: null },
        end_time: { type: "timestamptz", required: false, default: null },
      },
    },
    post_insights: {
      required: ["post_id", "metric_name"],
      fields: {
        post_id: { type: "text", required: true },
        metric_name: { type: "text", required: true },
        metric_value: { type: "jsonb", required: false, default: null },
        period: { type: "text", required: false, default: null },
        end_time: { type: "timestamptz", required: false, default: null },
      },
    },
    cm_earnings_post: {
      required: ["post_id"],
      fields: {
        post_id: { type: "text", required: true },
        earnings_amount: { type: "numeric", required: false, default: 0 },
        approximate_earnings: { type: "numeric", required: false, default: 0 },
        currency: { type: "text", required: false, default: "USD" },
        period: { type: "text", required: false, default: null },
        end_time: { type: "timestamptz", required: false, default: null },
      },
    },
    cm_earnings_page: {
      required: ["page_id"],
      fields: {
        page_id: { type: "text", required: true },
        earnings_amount: { type: "numeric", required: false, default: 0 },
        approximate_earnings: { type: "numeric", required: false, default: 0 },
        content_type_breakdown: { type: "jsonb", required: false, default: null },
        currency: { type: "text", required: false, default: "USD" },
        period: { type: "text", required: false, default: null },
        end_time: { type: "timestamptz", required: false, default: null },
      },
    },
    third_party_data: {
      required: ["data_type"],
      fields: {
        page_id: { type: "uuid", required: false, default: null },
        post_id: { type: "uuid", required: false, default: null },
        data_type: { type: "text", required: true },
        value: { type: "jsonb", required: false, default: null },
      },
    },
    sync_jobs: {
      required: ["page_id", "job_type"],
      fields: {
        page_id: { type: "uuid", required: true },
        job_type: { type: "text", required: true },
        status: { type: "text", required: false, default: "pending" },
        started_at: { type: "timestamptz", required: false, default: null },
        completed_at: { type: "timestamptz", required: false, default: null },
        error_log: { type: "text", required: false, default: null },
      },
    },
  };

  static getTableSchema(tableName: string): TableSchema | null {
    return this.dbSchema[tableName] || null;
  }

  static getRequiredFields(tableName: string): string[] {
    return this.dbSchema[tableName]?.required || [];
  }

  static validateData(tableName: string, data: AnyRecord): { valid: boolean; errors: string[] } {
    const schema = this.dbSchema[tableName];
    const errors: string[] = [];

    if (!schema) {
      return { valid: false, errors: [`Table schema for '${tableName}' not found`] };
    }

    for (const requiredField of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(data, requiredField) || data[requiredField] === undefined || data[requiredField] === null) {
        errors.push(`Required field '${requiredField}' is missing or null`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export const dbSchema = SchemaRegistry.dbSchema;
export const getTableSchema = SchemaRegistry.getTableSchema;
export const getRequiredFields = SchemaRegistry.getRequiredFields;
export const validateData = SchemaRegistry.validateData;
