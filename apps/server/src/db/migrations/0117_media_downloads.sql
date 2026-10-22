CREATE TABLE "media_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"server_user_id" uuid,
	"library_item_id" uuid,
	"rating_key" varchar(255),
	"title" text NOT NULL,
	"app" text,
	"device" text,
	"source" varchar(20) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"library_item_version_id" uuid,
	"video_resolution" varchar(20),
	"video_codec" varchar(50),
	"video_dynamic_range" varchar(20),
	"container" varchar(50),
	"file_size_bytes" bigint,
	"ip_address" varchar(45),
	"is_local" boolean,
	"geo_city" text,
	"geo_region" text,
	"geo_country" text,
	"geo_lat" double precision,
	"geo_lon" double precision,
	"delivered_bytes" bigint,
	"media_id" uuid,
	"device_id" varchar(255),
	"player_name" varchar(255),
	"product" varchar(255),
	"platform" varchar(100),
	"delivered_video_codec" varchar(50),
	"delivered_audio_codec" varchar(50),
	"delivered_container" varchar(50),
	"delivered_bitrate_kbps" integer,
	"delivered_resolution" varchar(20),
	"completion_percent" integer
);
--> statement-breakpoint
ALTER TABLE "media_downloads" ADD CONSTRAINT "media_downloads_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_downloads" ADD CONSTRAINT "media_downloads_server_user_id_server_users_id_fk" FOREIGN KEY ("server_user_id") REFERENCES "public"."server_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_downloads" ADD CONSTRAINT "media_downloads_library_item_id_library_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_downloads" ADD CONSTRAINT "media_downloads_library_item_version_id_library_item_versions_id_fk" FOREIGN KEY ("library_item_version_id") REFERENCES "public"."library_item_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_downloads_user_first_seen_idx" ON "media_downloads" USING btree ("server_user_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "media_downloads_server_item_last_seen_idx" ON "media_downloads" USING btree ("server_id","rating_key","last_seen_at");--> statement-breakpoint
CREATE INDEX "media_downloads_server_first_seen_idx" ON "media_downloads" USING btree ("server_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "media_downloads_media_id_idx" ON "media_downloads" USING btree ("media_id");