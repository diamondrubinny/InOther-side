CREATE TYPE "public"."transcript_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "media_transcripts" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"vault_id" uuid NOT NULL,
	"status" "transcript_status" DEFAULT 'pending' NOT NULL,
	"text_enc" "bytea",
	"language" text,
	"edited_by_legator" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_transcripts" ADD CONSTRAINT "media_transcripts_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_transcripts" ADD CONSTRAINT "media_transcripts_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;