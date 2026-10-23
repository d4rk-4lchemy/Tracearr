ALTER TABLE "termination_logs" ADD COLUMN "session_started_at" timestamp with time zone;--> statement-breakpoint
UPDATE "termination_logs" tl SET "session_started_at" = s."started_at" FROM "sessions" s WHERE s."id" = tl."session_id";
