import { z } from "zod";

/** Password-free capture links: one question, one answer, 7 days. See docs/CAPTURE.md. */
export const CAPTURE_LINK_DAYS = 7;
export const CAPTURE_AUDIO_MAX_BYTES = 100 * 1024 * 1024;
export const SUGGESTION_MAX_OPEN = 20;

export const createCaptureLinkSchema = z.discriminatedUnion("source", [
  /** questionId omitted → the next unanswered, non-sensitive catalog question. */
  z.object({ source: z.literal("catalog"), questionId: z.string().regex(/^[a-z0-9_.-]{1,64}$/).optional() }),
  z.object({ source: z.literal("custom"), text: z.string().trim().min(3).max(300) }),
  z.object({ source: z.literal("suggestion"), suggestionId: z.uuid() }),
]);
export type CreateCaptureLinkInput = z.infer<typeof createCaptureLinkSchema>;

export const capturePreferencesSchema = z.object({
  weeklyEnabled: z.boolean(),
  /** 0 = Sunday … 6 = Saturday, in the schedule time zone. */
  weekday: z.number().int().min(0).max(6),
});
export type CapturePreferences = z.infer<typeof capturePreferencesSchema>;

export const suggestionInputSchema = z.object({ text: z.string().trim().min(3).max(300) });

export const captureTokenSchema = z.object({ token: z.string().min(20).max(200) });
export const captureAnswerSchema = captureTokenSchema.extend({ text: z.string().trim().min(1).max(20_000) });
