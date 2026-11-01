CREATE TYPE "public"."persona_profile_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "persona_memories" (
	"vault_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"summary_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_profiles" (
	"vault_id" uuid PRIMARY KEY NOT NULL,
	"card_enc" "bytea" NOT NULL,
	"status" "persona_profile_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_settings" ADD COLUMN "eye_y" integer DEFAULT 420 NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_settings" ADD COLUMN "eye_spread" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_memories" ADD CONSTRAINT "persona_memories_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_memories" ADD CONSTRAINT "persona_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_profiles" ADD CONSTRAINT "persona_profiles_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_memories_uq" ON "persona_memories" USING btree ("vault_id","user_id");