CREATE TYPE "public"."message_recipient_status" AS ENUM('pending', 'done', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."message_trigger_kind" AS ENUM('on_release', 'date', 'birthday', 'age', 'yahrzeit', 'after_death', 'holiday', 'annual', 'life_event');--> statement-breakpoint
CREATE TABLE "message_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"occurrence_on" date NOT NULL,
	"held" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scheduled_message_recipients" (
	"message_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"status" "message_recipient_status" DEFAULT 'pending' NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"next_due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"title_enc" "bytea" NOT NULL,
	"body_enc" "bytea" NOT NULL,
	"trigger_enc" "bytea" NOT NULL,
	"trigger_kind" "message_trigger_kind" NOT NULL,
	"media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_requests" ADD COLUMN "death_after_sunset" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD COLUMN "birth_date_enc" "bytea";--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD COLUMN "born_after_sunset" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD COLUMN "messages_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_message_id_scheduled_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."scheduled_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_beneficiary_id_vault_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."vault_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_message_recipients" ADD CONSTRAINT "scheduled_message_recipients_message_id_scheduled_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."scheduled_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_message_recipients" ADD CONSTRAINT "scheduled_message_recipients_beneficiary_id_vault_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."vault_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_delivery_uq" ON "message_deliveries" USING btree ("message_id","beneficiary_id","occurrence_on");--> statement-breakpoint
CREATE INDEX "message_delivery_beneficiary_idx" ON "message_deliveries" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_recipient_uq" ON "scheduled_message_recipients" USING btree ("message_id","beneficiary_id");--> statement-breakpoint
CREATE INDEX "message_recipient_due_idx" ON "scheduled_message_recipients" USING btree ("status","next_due_on");--> statement-breakpoint
CREATE INDEX "messages_vault_idx" ON "scheduled_messages" USING btree ("vault_id");