ALTER TABLE "servers"
ADD COLUMN IF NOT EXISTS "ignore_anonymous_streams" boolean DEFAULT true NOT NULL;
