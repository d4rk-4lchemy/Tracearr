ALTER TABLE "users" ADD COLUMN "login_access" varchar(10) DEFAULT 'default' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "login_access" = 'allow' WHERE "can_login";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "can_login";