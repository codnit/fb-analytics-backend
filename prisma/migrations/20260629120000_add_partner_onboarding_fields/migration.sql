-- Bring existing production databases in line with the current Partner profile schema.
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "publisher_type" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "website_url" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "niche_category" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "reason_joining" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;

-- Used by connected page lists to show the most recent completed sync time.
ALTER TABLE "connected_pages" ADD COLUMN IF NOT EXISTS "latest_sync_completed_at" TIMESTAMPTZ(6);
