CREATE TYPE "public"."beneficiary_status" AS ENUM('designated', 'invited', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('terms_and_privacy', 'legacy_vault_processing', 'voice_cloning', 'avatar_creation', 'ai_processing');--> statement-breakpoint
CREATE TYPE "public"."executor_status" AS ENUM('designated', 'invited', 'confirmed', 'removed');--> statement-breakpoint
CREATE TYPE "public"."relation" AS ENUM('spouse', 'partner', 'child', 'grandchild', 'parent', 'sibling', 'relative', 'friend', 'other');--> statement-breakpoint
CREATE TYPE "public"."story_audience" AS ENUM('all', 'specific');--> statement-breakpoint
CREATE TYPE "public"."story_delivery" AS ENUM('persona_tells', 'original_only');--> statement-breakpoint
CREATE TYPE "public"."story_release_rule" AS ENUM('on_release', 'date', 'on_topic');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('email_verify', 'password_reset', 'mfa_challenge');--> statement-breakpoint
CREATE TYPE "public"."vault_status" AS ENUM('building', 'release_pending', 'released', 'never_release');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"ip_hash" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guided_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"text_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legator_user_id" uuid NOT NULL,
	"status" "vault_status" DEFAULT 'building' NOT NULL,
	"release_wait_days" integer DEFAULT 14 NOT NULL,
	"require_second_executor" boolean DEFAULT true NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"kek_id" text NOT NULL,
	"opening_message_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"title_enc" "bytea" NOT NULL,
	"body_enc" "bytea" NOT NULL,
	"audience" "story_audience" NOT NULL,
	"release_rule" "story_release_rule" NOT NULL,
	"release_at" date,
	"topic_enc" "bytea",
	"delivery" "story_delivery" NOT NULL,
	"sensitivity_ack" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reauth_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sealed_story_audience" (
	"story_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_totp_usage" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_counter" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"locale" text DEFAULT 'he' NOT NULL,
	"adult_confirmed_at" timestamp with time zone NOT NULL,
	"totp_secret_enc" "bytea",
	"mfa_enabled_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"name_enc" "bytea" NOT NULL,
	"email_enc" "bytea" NOT NULL,
	"relation" "relation" NOT NULL,
	"notify_before_death" boolean DEFAULT false NOT NULL,
	"status" "beneficiary_status" DEFAULT 'designated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_executors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"name_enc" "bytea" NOT NULL,
	"email_enc" "bytea" NOT NULL,
	"relation" "relation" NOT NULL,
	"status" "executor_status" DEFAULT 'designated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_answers" ADD CONSTRAINT "guided_answers_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_vaults" ADD CONSTRAINT "legacy_vaults_legator_user_id_users_id_fk" FOREIGN KEY ("legator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_stories" ADD CONSTRAINT "sealed_stories_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_story_audience" ADD CONSTRAINT "sealed_story_audience_story_id_sealed_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."sealed_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_story_audience" ADD CONSTRAINT "sealed_story_audience_beneficiary_id_vault_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."vault_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_totp_usage" ADD CONSTRAINT "mfa_totp_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_beneficiaries" ADD CONSTRAINT "vault_beneficiaries_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_executors" ADD CONSTRAINT "vault_executors_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "consents_user_idx" ON "consents" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_vault_question_uq" ON "guided_answers" USING btree ("vault_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_legator_uq" ON "legacy_vaults" USING btree ("legator_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ott_token_hash_uq" ON "one_time_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ott_user_purpose_idx" ON "one_time_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "recovery_user_idx" ON "mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stories_vault_idx" ON "sealed_stories" USING btree ("vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_audience_uq" ON "sealed_story_audience" USING btree ("story_id","beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "beneficiaries_vault_idx" ON "vault_beneficiaries" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "executors_vault_idx" ON "vault_executors" USING btree ("vault_id");