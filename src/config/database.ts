import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Environment } from "./environment";

class DatabaseConnection {
  private prisma: PrismaClient | null = null;
  private schemaAligned = false;

  private createClient(): PrismaClient {
    const databaseUrl = Environment.databaseUrl;

    if (!databaseUrl) {
      throw new Error("Missing DATABASE_URL in environment");
    }

    return new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });
  }

  async connect(): Promise<PrismaClient> {
    if (!this.prisma) {
      this.prisma = this.createClient();
    }

    await this.prisma.$connect();
    await this.alignInsightIdColumns();
    await this.alignPublishingSchema();
    console.log("Prisma PostgreSQL connected successfully");
    return this.prisma;
  }

  get client(): PrismaClient {
    if (!this.prisma) {
      this.prisma = this.createClient();
    }

    return this.prisma;
  }

  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = null;
      this.schemaAligned = false;
    }
  }

  private async alignInsightIdColumns(): Promise<void> {
    if (!this.prisma || this.schemaAligned) {
      return;
    }

    const pageInsightColumn = (await this.prisma.$queryRawUnsafe(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'page_insights' AND column_name = 'page_id' LIMIT 1"
    )) as Array<{ data_type: string }>;

    if (pageInsightColumn[0]?.data_type === "uuid") {
      await this.prisma.$executeRawUnsafe("ALTER TABLE page_insights ALTER COLUMN page_id TYPE TEXT USING page_id::TEXT");
      await this.prisma.$executeRawUnsafe(
        "UPDATE page_insights pi SET page_id = cp.fb_page_id FROM connected_pages cp WHERE pi.page_id = cp.id::TEXT"
      );
    }

    const postInsightColumn = (await this.prisma.$queryRawUnsafe(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'post_insights' AND column_name = 'post_id' LIMIT 1"
    )) as Array<{ data_type: string }>;

    if (postInsightColumn[0]?.data_type === "uuid") {
      await this.prisma.$executeRawUnsafe("ALTER TABLE post_insights ALTER COLUMN post_id TYPE TEXT USING post_id::TEXT");
      await this.prisma.$executeRawUnsafe(
        "UPDATE post_insights poi SET post_id = p.fb_post_id FROM posts p WHERE poi.post_id = p.id::TEXT"
      );
    }

    this.schemaAligned = true;
  }

  private async alignPublishingSchema(): Promise<void> {
    if (!this.prisma) {
      return;
    }

    await this.prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "publishing_enabled" BOOLEAN NOT NULL DEFAULT false'
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "publishing_granted_at" TIMESTAMPTZ(6)'
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "publishing_granted_by" TEXT'
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "facebook_permissions" JSONB'
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "permissions_checked_at" TIMESTAMPTZ(6)'
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "facebook_reauth_required" BOOLEAN NOT NULL DEFAULT false'
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "facebook_reauth_required_at" TIMESTAMPTZ(6)'
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "facebook_reauth_reason" TEXT'
    );
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "publishing_posts" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "page_id" UUID NOT NULL,
        "fb_page_id" TEXT NOT NULL,
        "fb_post_id" TEXT,
        "permalink" TEXT,
        "post_type" TEXT NOT NULL,
        "message" TEXT,
        "link" TEXT,
        "media_url" TEXT,
        "media_object_key" TEXT,
        "scheduled_publish_time" TIMESTAMPTZ(6),
        "status" TEXT NOT NULL DEFAULT 'pending',
        "graph_response" JSONB,
        "error_message" TEXT,
        "attempt_count" INTEGER NOT NULL DEFAULT 0,
        "last_attempt_at" TIMESTAMPTZ(6),
        "next_retry_at" TIMESTAMPTZ(6),
        "created_by" TEXT,
        "created_via" TEXT NOT NULL DEFAULT 'api',
        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "publishing_posts_pkey" PRIMARY KEY ("id")
      )
    `);
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "publishing_posts_page_id_idx" ON "publishing_posts"("page_id")');
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "publishing_posts_fb_page_id_idx" ON "publishing_posts"("fb_page_id")');
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "publishing_posts_fb_post_id_idx" ON "publishing_posts"("fb_post_id")');
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "publishing_posts_status_idx" ON "publishing_posts"("status")');
    await this.prisma.$executeRawUnsafe('ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "media_object_key" TEXT');
    await this.prisma.$executeRawUnsafe('ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0');
    await this.prisma.$executeRawUnsafe('ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "last_attempt_at" TIMESTAMPTZ(6)');
    await this.prisma.$executeRawUnsafe('ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMPTZ(6)');
    await this.prisma.$executeRawUnsafe('ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "permalink" TEXT');
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "recipient_partner_id" UUID NOT NULL,
        "connected_page_id" UUID NOT NULL,
        "publishing_post_id" UUID NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'facebook_post_published',
        "title" TEXT NOT NULL,
        "message" TEXT,
        "page_name" TEXT,
        "post_url" TEXT,
        "is_read" BOOLEAN NOT NULL DEFAULT false,
        "read_at" TIMESTAMPTZ(6),
        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "notifications_recipient_post_type_key" UNIQUE ("recipient_partner_id", "publishing_post_id", "type")
      )
    `);
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "notifications_recipient_read_created_idx" ON "notifications"("recipient_partner_id", "is_read", "created_at")');
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "notifications_publishing_post_id_idx" ON "notifications"("publishing_post_id")');
  }
}

export const database = new DatabaseConnection();

export const connectDB = async (): Promise<PrismaClient> => database.connect();
export const getDB = (): PrismaClient => database.client;
export const disconnectDB = async (): Promise<void> => database.disconnect();
