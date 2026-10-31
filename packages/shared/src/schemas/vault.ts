import { z } from "zod";
import { emailSchema } from "./auth.js";

export const RELATIONS = [
  "spouse",
  "partner",
  "child",
  "grandchild",
  "parent",
  "sibling",
  "relative",
  "friend",
  "other",
] as const;
export const relationSchema = z.enum(RELATIONS);
export type Relation = z.infer<typeof relationSchema>;

export const RELEASE_WAIT_DAYS_MIN = 7;
export const RELEASE_WAIT_DAYS_MAX = 90;

export const updateVaultSchema = z
  .object({
    releaseWaitDays: z.number().int().min(RELEASE_WAIT_DAYS_MIN).max(RELEASE_WAIT_DAYS_MAX),
    /** When true the vault is never released, even after a verified death. */
    neverRelease: z.boolean(),
    requireSecondExecutor: z.boolean(),
    /** Opening message shown to beneficiaries on release. */
    openingMessage: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: "empty_update" });
export type UpdateVaultInput = z.infer<typeof updateVaultSchema>;

const personName = z.string().trim().min(1).max(120);

export const beneficiaryInputSchema = z.object({
  name: personName,
  relation: relationSchema,
  email: emailSchema,
  /** Whether the beneficiary is told now (while the legator is alive) that they were designated. */
  notifyBeforeDeath: z.boolean().default(false),
});
export type BeneficiaryInput = z.infer<typeof beneficiaryInputSchema>;
export const beneficiaryUpdateSchema = beneficiaryInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: "empty_update" });

export const executorInputSchema = z.object({
  name: personName,
  relation: relationSchema,
  email: emailSchema,
});
export type ExecutorInput = z.infer<typeof executorInputSchema>;
export const executorUpdateSchema = executorInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: "empty_update" });

export const STORY_AUDIENCES = ["all", "specific"] as const;
export const STORY_RELEASE_RULES = ["on_release", "date", "on_topic"] as const;
export const STORY_DELIVERIES = ["persona_tells", "original_only"] as const;

const storyBase = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  audience: z.enum(STORY_AUDIENCES),
  beneficiaryIds: z.array(z.uuid()).max(50).default([]),
  releaseRule: z.enum(STORY_RELEASE_RULES),
  /** ISO date (YYYY-MM-DD). Required when releaseRule = "date". */
  releaseAt: z.iso.date().nullable().default(null),
  /** Free-text topic. Required when releaseRule = "on_topic". */
  topic: z.string().trim().min(1).max(200).nullable().default(null),
  delivery: z.enum(STORY_DELIVERIES),
  /** Legator acknowledged the "may hurt others" warning. */
  sensitivityAck: z.boolean().default(false),
});

type StoryShape = z.infer<typeof storyBase>;

function storyRules(v: Partial<StoryShape>, ctx: z.RefinementCtx): void {
  if (v.audience === "specific" && (!v.beneficiaryIds || v.beneficiaryIds.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["beneficiaryIds"], message: "beneficiaries_required" });
  }
  if (v.audience === "all" && v.beneficiaryIds && v.beneficiaryIds.length > 0) {
    ctx.addIssue({ code: "custom", path: ["beneficiaryIds"], message: "beneficiaries_not_allowed" });
  }
  if (v.releaseRule === "date" && !v.releaseAt) {
    ctx.addIssue({ code: "custom", path: ["releaseAt"], message: "release_date_required" });
  }
  if (v.releaseRule === "on_topic" && !v.topic) {
    ctx.addIssue({ code: "custom", path: ["topic"], message: "topic_required" });
  }
}

export const storyInputSchema = storyBase.superRefine(storyRules);
export type StoryInput = z.infer<typeof storyInputSchema>;

/** Updates replace the whole story, so cross-field rules can always be checked. */
export const storyUpdateSchema = storyInputSchema;

export const answerInputSchema = z.object({
  questionId: z.string().regex(/^[a-z0-9_.-]{1,64}$/),
  text: z.string().trim().min(1).max(20_000),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const uuidParamSchema = z.object({ id: z.uuid() });
