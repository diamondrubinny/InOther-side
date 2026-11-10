import { asc, eq, inArray } from "drizzle-orm";
import { QUESTION_TOPICS, type Locale, type TimelineEvent } from "@inother/shared";
import type { AppContext } from "../../context.js";
import { guidedAnswers, interviewEntries, legacyVaults, mediaAssets, mediaTranscripts, sealedStories, users } from "../../db/schema.js";
import type { VaultCipher } from "../../lib/crypto/keys.js";
import { mediaAad } from "../media/media.service.js";
import { loadTimeline } from "../timeline/timeline.service.js";

type VaultRow = typeof legacyVaults.$inferSelect;
type StoryRow = typeof sealedStories.$inferSelect;
type MediaRow = typeof mediaAssets.$inferSelect;

export interface LegacyBook {
  vaultId: string;
  legatorName: string;
  openingMessage: string | null;
  /** Life events in chronological order (links only to material in this book). */
  timeline: TimelineEvent[];
  /** Guided answers grouped by catalog topic, in catalog order. */
  chapters: { id: string; title: string; entries: { question: string; answer: string }[] }[];
  interviews: { question: string; answer: string }[];
  stories: { id: string; title: string; body: string }[];
  /** Voice/video recordings: transcript (if any) + id for the QR link to the original. */
  recordings: { id: string; kind: "audio" | "video"; label: string | null; transcript: string | null }[];
  photos: { id: string; label: string | null }[];
}

/**
 * Assembles the printable legacy book from material the CALLER has already authorized:
 * `stories` and `media` must be exactly what this reader may see (everything for the legator;
 * the audience/timing-filtered sets for a beneficiary).
 */
export async function composeBook(
  ctx: AppContext,
  vault: VaultRow,
  cipher: VaultCipher,
  locale: Locale,
  stories: StoryRow[],
  media: MediaRow[],
  /** True for beneficiaries: timeline links are limited to `stories` / `media`. */
  restrictLinks = false,
): Promise<LegacyBook> {
  const [legator] = await ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, vault.legatorUserId));
  const answers = new Map(
    (await ctx.db.select().from(guidedAnswers).where(eq(guidedAnswers.vaultId, vault.id))).map((a) => [a.questionId, cipher.decrypt(a.textEnc, `answer.text:${a.id}`)]),
  );
  const chapters = QUESTION_TOPICS.map((t) => ({
    id: t.id,
    title: t.title[locale],
    entries: t.questions.filter((q) => answers.has(q.id)).map((q) => ({ question: q.text[locale], answer: answers.get(q.id) as string })),
  })).filter((c) => c.entries.length > 0);

  const interviews = (await ctx.db.select().from(interviewEntries).where(eq(interviewEntries.vaultId, vault.id)).orderBy(asc(interviewEntries.createdAt))).map((e) => ({
    question: cipher.decrypt(e.questionEnc, `interview.question:${e.id}`),
    answer: cipher.decrypt(e.answerEnc, `interview.answer:${e.id}`),
  }));

  const clean = media.filter((m) => m.status === "clean");
  const recordingRows = clean.filter((m) => m.kind !== "image");
  const transcripts = recordingRows.length
    ? new Map(
        (
          await ctx.db
            .select()
            .from(mediaTranscripts)
            .where(inArray(mediaTranscripts.mediaId, recordingRows.map((m) => m.id)))
        )
          .filter((t) => t.status === "done" && t.textEnc)
          .map((t) => [t.mediaId, cipher.decrypt(t.textEnc as Buffer, `media.transcript:${t.mediaId}`)]),
      )
    : new Map<string, string>();
  const label = (m: MediaRow) => (m.labelEnc ? cipher.decrypt(m.labelEnc, mediaAad.label(m.id)) : null);

  return {
    vaultId: vault.id,
    legatorName: legator?.name ?? "",
    openingMessage: vault.openingMessageEnc ? cipher.decrypt(vault.openingMessageEnc, `vault.opening_message:${vault.id}`) : null,
    timeline: await loadTimeline(ctx, vault, cipher, restrictLinks ? { storyIds: new Set(stories.map((s) => s.id)), mediaIds: new Set(clean.map((m) => m.id)) } : undefined),
    chapters,
    interviews,
    stories: stories.map((s) => ({ id: s.id, title: cipher.decrypt(s.titleEnc, `story.title:${s.id}`), body: cipher.decrypt(s.bodyEnc, `story.body:${s.id}`) })),
    recordings: recordingRows.map((m) => ({ id: m.id, kind: m.kind as "audio" | "video", label: label(m), transcript: transcripts.get(m.id) ?? null })),
    photos: clean.filter((m) => m.kind === "image").map((m) => ({ id: m.id, label: label(m) })),
  };
}
