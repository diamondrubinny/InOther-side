import { z } from "zod";

/**
 * A life-event date with optional precision: "YYYY", "YYYY-MM" or "YYYY-MM-DD".
 * (People often remember only the year.) Lexicographic order == chronological order.
 */
export const partialDateSchema = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "invalid_date")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number) as [number, number | undefined, number | undefined];
    if (y < 1850) return false;
    if (m !== undefined && (m < 1 || m > 12)) return false;
    if (d !== undefined && m !== undefined && (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate())) return false;
    return true;
  }, "invalid_date");

export const TIMELINE_LIMIT = 300;

export const timelineEventInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  date: partialDateSchema,
  description: z.string().trim().max(5000).nullable().default(null),
  storyId: z.uuid().nullable().default(null),
  mediaId: z.uuid().nullable().default(null),
});
export type TimelineEventInput = z.infer<typeof timelineEventInputSchema>;

export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string | null;
  storyId: string | null;
  mediaId: string | null;
}

/** Sort key that puts "1961" before "1961-03" before "1961-03-07", and earlier years first. */
export function compareTimeline(a: { date: string }, b: { date: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

export function decadeOf(date: string): number {
  return Math.floor(Number(date.slice(0, 4)) / 10) * 10;
}
