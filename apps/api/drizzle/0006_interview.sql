CREATE TABLE "interview_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"sitting_id" uuid NOT NULL,
	"topic_id" text,
	"question_enc" "bytea" NOT NULL,
	"answer_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_entries" ADD CONSTRAINT "interview_entries_vault_id_legacy_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."legacy_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_vault_idx" ON "interview_entries" USING btree ("vault_id","created_at");--> statement-breakpoint
CREATE INDEX "interview_sitting_idx" ON "interview_entries" USING btree ("sitting_id");