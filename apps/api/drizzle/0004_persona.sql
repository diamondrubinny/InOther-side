CREATE TYPE "public"."persona_kind" AS ENUM('regular', 'farewell');--> statement-breakpoint
CREATE TYPE "public"."persona_mode" AS ENUM('preview', 'beneficiary');--> statement-breakpoint
CREATE TYPE "public"."voice_status" AS ENUM('none', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "persona_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" "persona_mode" NOT NULL,
	"kind" "persona_kind" DEFAULT 'regular' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"turns" integer DEFAULT 0 NOT NULL,
	"safety_flag" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_settings" (
	"vault_id" uuid PRIMARY KEY NOT NULL,
	"portrait_media_id" uuid,
	"mouth_x" integer DEFAULT 500 NOT NULL,
	"mouth_y" integer DEFAULT 680 NOT NULL,
	"voice_ref_enc" "bytea",
	"voice_status" "voice_status" DEFAULT 'none' NOT NULL,
	"sessions_limit" integer DEFAULT 8 NOT NULL,
	"minutes_limit" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_sessions" ADD CONSTRAINT "persona_sessions_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_sessions" ADD CONSTRAINT "persona_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_settings" ADD CONSTRAINT "persona_settings_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_settings" ADD CONSTRAINT "persona_settings_portrait_media_id_media_assets_id_fk" FOREIGN KEY ("portrait_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_sessions_user_idx" ON "persona_sessions" USING btree ("user_id","vault_id");