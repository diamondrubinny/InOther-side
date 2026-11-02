import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { QUESTION_TOPICS, type Locale } from "@inother/shared";
import type { AppContext } from "../../context.js";
import { consents, guidedAnswers, interviewEntries } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import type { VaultService } from "../vault/vault.service.js";
import { CRISIS_MESSAGE, screenForCrisis } from "./safety.js";

const qAad = (id: string) => `interview.question:${id}`;
const aAad = (id: string) => `interview.answer:${id}`;
/** How many earlier Q/A pairs of the sitting the interviewer sees when choosing a follow-up. */
const CONTEXT_PAIRS = 6;

/**
 * AI life-story interviewer for the living legator. Each answer is stored encrypted and becomes
 * persona material (and input for the personality card). Requires the AI-processing consent.
 */
export class InterviewService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
  ) {}

  private async requireConsent(userId: string): Promise<void> {
    const [c] = await this.ctx.db
      .select({ id: consents.id })
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.purpose, "ai_processing"), isNull(consents.withdrawnAt)));
    if (!c) throw conflict("persona_not_consented");
  }

  /** An unanswered catalog question in the topic (or anywhere), as an opener. */
  private async fallbackQuestion(vaultId: string, topicId: string | null, locale: Locale): Promise<string | null> {
    const answered = new Set(
      (await this.ctx.db.select({ q: guidedAnswers.questionId }).from(guidedAnswers).where(eq(guidedAnswers.vaultId, vaultId))).map((r) => r.q),
    );
    const topics = topicId ? QUESTION_TOPICS.filter((t) => t.id === topicId) : QUESTION_TOPICS;
    for (const t of topics) for (const q of t.questions) if (!answered.has(q.id)) return q.text[locale];
    return topics[0]?.questions[0]?.text[locale] ?? null;
  }

  async start(userId: string, topicId: string | null, locale: Locale) {
    const llm = this.ctx.llm;
    if (!llm) throw new AppError(503, "persona_unavailable");
    await this.requireConsent(userId);
    const { vault } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const topic = topicId ? QUESTION_TOPICS.find((t) => t.id === topicId) : null;
    const question = await llm.nextInterviewQuestion({
      topicTitle: topic?.title[locale] ?? null,
      sitting: [],
      fallbackQuestion: await this.fallbackQuestion(vault.id, topicId, locale),
      locale,
    });
    return { sittingId: randomUUID(), question };
  }

  async answer(
    userId: string,
    input: { sittingId: string; topicId: string | null; question: string; answer: string },
    locale: Locale,
    ipHash: string | null,
  ) {
    const llm = this.ctx.llm;
    if (!llm) throw new AppError(503, "persona_unavailable");
    await this.requireConsent(userId);
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const id = randomUUID();
    await this.ctx.db.insert(interviewEntries).values({
      id,
      vaultId: vault.id,
      sittingId: input.sittingId,
      topicId: input.topicId,
      questionEnc: cipher.encrypt(input.question, qAad(id)),
      answerEnc: cipher.encrypt(input.answer, aAad(id)),
    });
    await writeAudit(this.ctx.db, { actorId: userId, action: "interview.answer_saved", targetType: "vault", targetId: vault.id, ipHash });

    // Recording a life story can stir up a lot (some legators are terminally ill): watch for distress.
    const support = screenForCrisis(input.answer) ? CRISIS_MESSAGE[locale] : null;

    const previous = await this.ctx.db
      .select()
      .from(interviewEntries)
      .where(and(eq(interviewEntries.vaultId, vault.id), eq(interviewEntries.sittingId, input.sittingId)))
      .orderBy(desc(interviewEntries.createdAt))
      .limit(CONTEXT_PAIRS);
    const sitting = previous.reverse().map((r) => ({ question: cipher.decrypt(r.questionEnc, qAad(r.id)), answer: cipher.decrypt(r.answerEnc, aAad(r.id)) }));
    const topic = input.topicId ? QUESTION_TOPICS.find((t) => t.id === input.topicId) : null;
    const next = await llm.nextInterviewQuestion({
      topicTitle: topic?.title[locale] ?? null,
      sitting,
      fallbackQuestion: await this.fallbackQuestion(vault.id, input.topicId, locale),
      locale,
    });
    return { saved: id, next, support };
  }

  async list(userId: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const rows = await this.ctx.db.select().from(interviewEntries).where(eq(interviewEntries.vaultId, vault.id)).orderBy(asc(interviewEntries.createdAt));
    return rows.map((r) => ({
      id: r.id,
      topicId: r.topicId,
      question: cipher.decrypt(r.questionEnc, qAad(r.id)),
      answer: cipher.decrypt(r.answerEnc, aAad(r.id)),
      createdAt: r.createdAt,
      viaLink: r.captureLinkId !== null,
    }));
  }

  async delete(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const del = await this.ctx.db
      .delete(interviewEntries)
      .where(and(eq(interviewEntries.id, id), eq(interviewEntries.vaultId, vault.id)))
      .returning({ id: interviewEntries.id });
    if (del.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "interview.answer_deleted", targetType: "vault", targetId: vault.id, ipHash });
  }
}
