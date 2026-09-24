CREATE TABLE "server_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"effective_from" timestamp with time zone,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"city" varchar(255),
	"region" varchar(255),
	"country" varchar(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "location_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "location_synced_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "is_local" boolean;--> statement-breakpoint
ALTER TABLE "server_locations" ADD CONSTRAINT "server_locations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_locations_server_from_uidx" ON "server_locations" USING btree ("server_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "server_locations_server_undated_uidx" ON "server_locations" USING btree ("server_id") WHERE effective_from IS NULL;