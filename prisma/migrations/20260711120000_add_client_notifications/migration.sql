-- Store the resolved Facebook permalink with each publishing record.
ALTER TABLE "publishing_posts" ADD COLUMN IF NOT EXISTS "permalink" TEXT;

-- Durable, partner-scoped notifications for successful admin publications.
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
);

CREATE INDEX IF NOT EXISTS "notifications_recipient_read_created_idx"
  ON "notifications"("recipient_partner_id", "is_read", "created_at");

CREATE INDEX IF NOT EXISTS "notifications_publishing_post_id_idx"
  ON "notifications"("publishing_post_id");
