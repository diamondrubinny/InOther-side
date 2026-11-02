CREATE TYPE "public"."capture_source" AS ENUM('catalog', 'suggestion', 'custom');--> statement-breakpoint
CREATE TYPE "public"."capture_via" AS ENUM('manual', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'dismissed', 'answered');--> statement-breakpoint
CREATE TABLE "capture_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"source" "capture_source" NOT NULL,
	"question_id" text,
	"suggestion_id" uuid,
	"question_enc" "bytea",
	"created_via" "capture_via" DEFAULT 'manual' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_preferences" (
	"vault_id" uuid PRIMARY KEY NOT NULL,
	"weekly_enabled" boolean DEFAULT false NOT NULL,
	"weekday" integer DEFAULT 0 NOT NULL,
	"last_sent_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"text_enc" "bytea" NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guided_answers" ADD COLUMN "capture_link_id" uuid;--> statement-breakpoint
ALTER TABLE "interview_entries" ADD COLUMN "capture_link_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "capture_link_id" uuid;--> statement-breakpoint
ALTER TABLE "capture_links" ADD CONSTRAINT "capture_links_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_links" ADD CONSTRAINT "capture_links_suggestion_id_question_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."question_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_preferences" ADD CONSTRAINT "capture_preferences_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_suggestions" ADD CONSTRAINT "question_suggestions_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_suggestions" ADD CONSTRAINT "question_suggestions_beneficiary_id_vault_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."vault_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_token_uq" ON "capture_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "capture_vault_idx" ON "capture_links" USING btree ("vault_id","created_at");--> statement-breakpoint
CREATE INDEX "suggestions_vault_idx" ON "question_suggestions" USING btree ("vault_id","status");--> statement-breakpoint
CREATE INDEX "suggestions_beneficiary_idx" ON "question_suggestions" USING btree ("beneficiary_id");