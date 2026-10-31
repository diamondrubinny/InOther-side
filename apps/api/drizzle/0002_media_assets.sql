CREATE TYPE "public"."media_kind" AS ENUM('image', 'audio', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('awaiting_upload', 'uploading', 'quarantined', 'scanning', 'clean', 'rejected', 'infected', 'scan_failed');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"story_id" uuid,
	"kind" "media_kind" NOT NULL,
	"declared_mime" text NOT NULL,
	"declared_size" bigint NOT NULL,
	"size_bytes" bigint,
	"detected_mime" text,
	"status" "media_status" DEFAULT 'awaiting_upload' NOT NULL,
	"status_reason" text,
	"label_enc" "bytea",
	"scan_attempts" integer DEFAULT 0 NOT NULL,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_story_id_sealed_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."sealed_stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_vault_idx" ON "media_assets" USING btree ("vault_id","created_at");--> statement-breakpoint
CREATE INDEX "media_status_idx" ON "media_assets" USING btree ("status","created_at");