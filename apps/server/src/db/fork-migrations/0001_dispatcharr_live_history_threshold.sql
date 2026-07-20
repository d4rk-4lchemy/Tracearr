ALTER TABLE "servers"
ADD COLUMN IF NOT EXISTS "dispatcharr_live_history_threshold_seconds" integer DEFAULT 30 NOT NULL;
