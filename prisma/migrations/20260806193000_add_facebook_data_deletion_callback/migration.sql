ALTER TABLE "partners"
ADD COLUMN IF NOT EXISTS "facebook_data_deleted_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "facebook_data_deletion_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id_hash" TEXT NOT NULL,
  "confirmation_code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "status_message" TEXT,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "facebook_data_deletion_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "facebook_data_deletion_requests_user_id_hash_key" UNIQUE ("user_id_hash"),
  CONSTRAINT "facebook_data_deletion_requests_confirmation_code_key" UNIQUE ("confirmation_code")
);

CREATE INDEX IF NOT EXISTS "facebook_data_deletion_requests_confirmation_code_idx"
ON "facebook_data_deletion_requests"("confirmation_code");
