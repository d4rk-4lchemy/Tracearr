ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "dispatcharr_playback_kind" varchar(20),
ADD COLUMN IF NOT EXISTS "progress_estimated" boolean DEFAULT false NOT NULL;
