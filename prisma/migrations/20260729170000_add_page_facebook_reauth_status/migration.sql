ALTER TABLE "connected_pages"
  ADD COLUMN IF NOT EXISTS "facebook_reauth_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "facebook_reauth_required_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "facebook_reauth_reason" TEXT;
