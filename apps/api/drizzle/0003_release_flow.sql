CREATE TYPE "public"."invitation_kind" AS ENUM('executor', 'beneficiary');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('awaiting_document', 'pending_review', 'awaiting_second_confirmation', 'waiting_period', 'released', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'staff');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"kind" "invitation_kind" NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"reported_by_executor_id" uuid,
	"status" "release_status" DEFAULT 'awaiting_document' NOT NULL,
	"date_of_death" date NOT NULL,
	"document_mime" text,
	"document_size" integer,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"second_confirmed_by_executor_id" uuid,
	"wait_until" timestamp with time zone,
	"cancel_token_hash" "bytea" NOT NULL,
	"cancelled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vault_executors" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "vault_executors" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vault_executors" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_reported_by_executor_id_vault_executors_id_fk" FOREIGN KEY ("reported_by_executor_id") REFERENCES "public"."vault_executors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_second_confirmed_by_executor_id_vault_executors_id_fk" FOREIGN KEY ("second_confirmed_by_executor_id") REFERENCES "public"."vault_executors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_person_idx" ON "invitations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "release_vault_idx" ON "release_requests" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "release_status_idx" ON "release_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "release_one_open_per_vault" ON "release_requests" USING btree ("vault_id") WHERE "release_requests"."status" in ('awaiting_document', 'pending_review', 'awaiting_second_confirmation', 'waiting_period');--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD CONSTRAINT "vault_beneficiaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_executors" ADD CONSTRAINT "vault_executors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;