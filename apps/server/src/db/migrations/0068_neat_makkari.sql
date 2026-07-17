ALTER TABLE "servers"
ADD COLUMN "dispatcharr_live_history_threshold_seconds" integer DEFAULT 30 NOT NULL;
