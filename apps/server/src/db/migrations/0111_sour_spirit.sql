DROP INDEX "users_login_username_unique";--> statement-breakpoint
ALTER TABLE "server_users" ADD COLUMN "is_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "allow_member_login" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_login" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_username_unique" ON "users" USING btree (lower("username")) WHERE role IN ('owner', 'admin');--> statement-breakpoint
UPDATE users SET role = 'member' WHERE role IN ('viewer', 'admin');--> statement-breakpoint
INSERT INTO settings (name, value)
SELECT 'loginMethods', jsonb_build_object(
  'local', coalesce((SELECT (value)::boolean FROM settings WHERE name = 'localLoginEnabled'), true),
  'plex', true,
  'oidc', true,
  'member', false
)
ON CONFLICT (name) DO NOTHING;--> statement-breakpoint
DELETE FROM settings WHERE name IN ('localLoginEnabled', 'allowGuestAccess');
