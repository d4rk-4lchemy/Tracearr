DROP INDEX "users_display_name_idx";--> statement-breakpoint
CREATE INDEX "automations_name_idx" ON "automations" USING btree (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "users_display_name_idx" ON "users" USING btree (lower(coalesce("name", "username")),"id");