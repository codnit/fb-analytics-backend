-- Add publishing permission metadata without changing existing analytics token flow.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "publishing_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "publishing_token_encrypted" TEXT;
ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "publishing_granted_at" TIMESTAMPTZ(6);
ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "publishing_granted_by" TEXT;
ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "facebook_permissions" JSONB;
ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "permissions_checked_at" TIMESTAMPTZ(6);

-- Store publishing requests made by the internal API or App Review demo screen.
CREATE TABLE IF NOT EXISTS "publishing_posts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "page_id" UUID NOT NULL,
  "fb_page_id" TEXT NOT NULL,
  "fb_post_id" TEXT,
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
);

CREATE INDEX IF NOT EXISTS "publishing_posts_page_id_idx" ON "publishing_posts"("page_id");
CREATE INDEX IF NOT EXISTS "publishing_posts_fb_page_id_idx" ON "publishing_posts"("fb_page_id");
CREATE INDEX IF NOT EXISTS "publishing_posts_fb_post_id_idx" ON "publishing_posts"("fb_post_id");
CREATE INDEX IF NOT EXISTS "publishing_posts_status_idx" ON "publishing_posts"("status");

ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "media_object_key" TEXT;
ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "last_attempt_at" TIMESTAMPTZ(6);
ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMPTZ(6);
