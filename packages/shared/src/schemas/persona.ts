import { z } from "zod";

const shortText = z.string().trim().min(1).max(300);

/**
 * The legator's personality card: distilled from their own material, reviewed and approved
 * by them. It lets the persona stay in character on topics the material never covered,
 * without inventing facts or memories.
 */
export const personaCardSchema = z.object({
  /** How they refer to themselves / like to be called. */
  preferredName: z.string().trim().max(80).default(""),
  /** Short descriptions of character traits, e.g. "optimistic", "dry humor". */
  traits: z.array(shortText).max(12).default([]),
  /** Core values and beliefs, in their words where possible. */
  values: z.array(shortText).max(10).default([]),
  /** What their humor is like. */
  humor: z.string().trim().max(600).default(""),
  /** Verbatim expressions / catchphrases. */
  speechPatterns: z.array(shortText).max(15).default([]),
  /** How they comfort, encourage, react to good and bad news. */
  emotionalStyle: z.string().trim().max(800).default(""),
  /** How they address specific people (matched to beneficiaries by name). */
  relationships: z
    .array(z.object({ name: z.string().trim().min(1).max(120), relation: z.string().trim().max(60).default(""), howIAddressThem: z.string().trim().max(120).default("") }))
    .max(30)
    .default([]),
  /** Topics the persona should not bring up. */
  topicsToAvoid: z.array(shortText).max(15).default([]),
  /** Legator's own corrections from trying the persona ("I'd never say it like that"). */
  corrections: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});
export type PersonaCard = z.infer<typeof personaCardSchema>;

export const personaFeedbackSchema = z.object({
  reply: z.string().trim().min(1).max(2000),
  verdict: z.enum(["like_me", "not_like_me"]),
  correction: z.string().trim().max(500).optional(),
});
