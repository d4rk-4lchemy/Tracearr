CREATE TABLE "user_merge_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"acting_user_id" uuid,
	"moved_server_user_ids" jsonb NOT NULL,
	"combined_server_users" jsonb NOT NULL,
	"was_same_server_combine" boolean DEFAULT false NOT NULL,
	"source_user_snapshot" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_merge_audits" ADD CONSTRAINT "user_merge_audits_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merge_audits" ADD CONSTRAINT "user_merge_audits_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_merge_audits_target_idx" ON "user_merge_audits" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "user_merge_audits_created_at_idx" ON "user_merge_audits" USING btree ("created_at");