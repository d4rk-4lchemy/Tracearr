ALTER TABLE "library_item_versions" ADD COLUMN "audio_atmos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "library_item_versions" ADD COLUMN "edition_title" varchar(100);