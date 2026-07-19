ALTER TABLE "sessions"
ADD COLUMN "dispatcharr_playback_kind" varchar(20),
ADD COLUMN "progress_estimated" boolean DEFAULT false NOT NULL;
