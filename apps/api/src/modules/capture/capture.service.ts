import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import {
  ALLOWED_CONTENT_TYPES,
  CAPTURE_AUDIO_MAX_BYTES,
  CAPTURE_LINK_DAYS,
  DEFAULT_LOCALE,
  QUESTION_TOPICS,
  SUGGESTION_MAX_OPEN,
  findQuestion,
  isLocale,
  isoDateInTimeZone,
  type CapturePreferences,
  type CreateCaptureLinkInput,
  type Locale,
} from "@inother/shared";
import type { AppContext } from "../../context.js";
import {
  capturePreferences,
  captureLinks,
  guidedAnswers,
  interviewEntries,
  legacyVaults,
  mediaAssets,
  questionSuggestions,
  users,
  vaultBeneficiaries,
} from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { generateToken, sha256 } from "../../lib/crypto/tokens.js";
import { VaultCipher } from "../../lib/crypto/keys.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import type { MediaService } from "../media/media.service.js";
import type { VaultService } from "../vault/vault.service.js";
import { captureEmails } from "./emails.js";

const MAX_ACTIVE_LINKS = 20;
const aad = {
  question: (id: string) => `capture.question:${id}`,
  suggestion: (id: string) => `suggestion.text:${id}`,
  answer: (id: string) => `answer.text:${id}`,
  interviewQ: (id: string) => `interview.question:${id}`,
  interviewA: (id: string) => `interview.answer:${id}`,
  beneficiaryName: (id: string) => `beneficiary.name:${id}`,
};
/** One uniform error for any unusable token (no hint whether it exists, expired, or was used). */
const invalidToken = () => badRequest("invalid_or_expired_token");

type VaultRow = typeof legacyVaults.$inferSelect;
type LinkRow = typeof captureLinks.$inferSelect;

/**
 * Password-free capture: one question, one answer, via a short-lived link. Also the weekly
 * question and questions suggested by the family. See docs/CAPTURE.md.
 */
export class CaptureService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
    private readonly media: MediaService,
  ) {}

  private async legatorOf(vault: VaultRow) {
    const [u] = await this.ctx.db
      .select({ email: users.email, displayName: users.displayName, locale: users.locale })
      .from(users)
      .where(eq(users.id, vault.legatorUserId));
    if (!u) throw notFound();
    return { ...u, locale: isLocale(u.locale) ? u.locale : DEFAULT_LOCALE };
  }

  private linkUrl(locale: Locale, token: string): string {
    const url = new URL(`/${locale}/capture`, this.ctx.env.WEB_ORIGIN);
    url.hash = `token=${token}`;
    return url.toString();
  }

  private questionText(link: LinkRow, cipher: VaultCipher, locale: Locale): string {
    if (link.source === "catalog" && link.questionId) return findQuestion(link.questionId)?.text[locale] ?? link.questionId;
    return link.questionEnc ? cipher.decrypt(link.questionEnc, aad.question(link.id)) : "";
  }

  private status(l: LinkRow): "active" | "used" | "revoked" | "expired" {
    if (l.usedAt) return "used";
    if (l.revokedAt) return "revoked";
    if (l.expiresAt <= this.ctx.now()) return "expired";
    return "active";
  }

  private activeLinkWhere(vaultId: string) {
    return and(eq(captureLinks.vaultId, vaultId), isNull(captureLinks.usedAt), isNull(captureLinks.revokedAt), gt(captureLinks.expiresAt, this.ctx.now()));
  }

  /** Next unanswered, NON-sensitive catalog question without an active link. */
  private async nextCatalogQuestion(vaultId: string): Promise<string | null> {
    const answered = new Set(
      (await this.ctx.db.select({ q: guidedAnswers.questionId }).from(guidedAnswers).where(eq(guidedAnswers.vaultId, vaultId))).map((r) => r.q),
    );
    const linked = await this.ctx.db.select({ q: captureLinks.questionId }).from(captureLinks).where(this.activeLinkWhere(vaultId));
    for (const r of linked) if (r.q) answered.add(r.q);
    for (const topic of QUESTION_TOPICS) for (const q of topic.questions) if (!q.sensitive && !answered.has(q.id)) return q.id;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Legator: links
  // ---------------------------------------------------------------------------

  async listLinks(userId: string, locale: Locale) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const rows = await this.ctx.db.select().from(captureLinks).where(eq(captureLinks.vaultId, vault.id)).orderBy(desc(captureLinks.createdAt)).limit(50);
    return rows.map((l) => ({
      id: l.id,
      question: this.questionText(l, cipher, locale),
      source: l.source,
      createdVia: l.createdVia,
      status: this.status(l),
      expiresAt: l.expiresAt,
      usedAt: l.usedAt,
      createdAt: l.createdAt,
    }));
  }

  private async issue(
    vault: VaultRow,
    cipher: VaultCipher,
    q: { source: LinkRow["source"]; questionId?: string | null; suggestionId?: string | null; text?: string | null },
    via: LinkRow["createdVia"],
  ) {
    const id = randomUUID();
    const token = generateToken();
    const expiresAt = new Date(this.ctx.now().getTime() + CAPTURE_LINK_DAYS * 86_400_000);
    const [row] = await this.ctx.db
      .insert(captureLinks)
      .values({
        id,
        vaultId: vault.id,
        tokenHash: sha256(token),
        source: q.source,
        questionId: q.questionId ?? null,
        suggestionId: q.suggestionId ?? null,
        questionEnc: q.text ? cipher.encrypt(q.text, aad.question(id)) : null,
        createdVia: via,
        expiresAt,
        createdAt: this.ctx.now(),
      })
      .returning();
    return { row: row as LinkRow, token };
  }

  async createLink(userId: string, input: CreateCaptureLinkInput, sendToMyEmail: boolean, locale: Locale, ipHash: string | null) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const [active] = await this.ctx.db.select({ n: count() }).from(captureLinks).where(this.activeLinkWhere(vault.id));
    if ((active?.n ?? 0) >= MAX_ACTIVE_LINKS) throw conflict("limit_reached");

    let q: Parameters<CaptureService["issue"]>[2];
    if (input.source === "catalog") {
      const questionId = input.questionId ?? (await this.nextCatalogQuestion(vault.id));
      if (!questionId) throw conflict("no_questions_left");
      if (!findQuestion(questionId)) throw badRequest("unknown_question");
      q = { source: "catalog", questionId };
    } else if (input.source === "custom") {
      q = { source: "custom", text: input.text };
    } else {
      const [s] = await this.ctx.db
        .select()
        .from(questionSuggestions)
        .where(and(eq(questionSuggestions.id, input.suggestionId), eq(questionSuggestions.vaultId, vault.id), inArray(questionSuggestions.status, ["pending", "accepted"])));
      if (!s) throw notFound();
      await this.ctx.db.update(questionSuggestions).set({ status: "accepted", updatedAt: this.ctx.now() }).where(eq(questionSuggestions.id, s.id));
      q = { source: "suggestion", suggestionId: s.id, text: cipher.decrypt(s.textEnc, aad.suggestion(s.id)) };
    }
    const { row, token } = await this.issue(vault, cipher, q, "manual");
    const url = this.linkUrl(locale, token);
    const question = this.questionText(row, cipher, locale);
    if (sendToMyEmail) {
      const legator = await this.legatorOf(vault);
      await this.ctx.mailer.send(captureEmails.questionLink(legator.email, locale, question, url, CAPTURE_LINK_DAYS, false));
    }
    await writeAudit(this.ctx.db, { actorId: userId, action: "capture.link_created", targetType: "capture_link", targetId: row.id, ipHash, metadata: { source: row.source, emailed: sendToMyEmail } });
    // The token is returned exactly once, here. Only its hash is stored.
    return { id: row.id, url, question, expiresAt: row.expiresAt, status: "active" as const };
  }

  async revokeLink(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.vaults.getOwned(userId);
    const rows = await this.ctx.db
      .update(captureLinks)
      .set({ revokedAt: this.ctx.now() })
      .where(and(eq(captureLinks.id, id), eq(captureLinks.vaultId, vault.id), isNull(captureLinks.usedAt), isNull(captureLinks.revokedAt)))
      .returning({ id: captureLinks.id });
    if (rows.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "capture.link_revoked", targetType: "capture_link", targetId: id, ipHash });
  }

  // ---------------------------------------------------------------------------
  // Legator: weekly question preferences
  // ---------------------------------------------------------------------------

  async getPreferences(userId: string): Promise<CapturePreferences> {
    const { vault } = await this.vaults.getOwned(userId);
    const [p] = await this.ctx.db.select().from(capturePreferences).where(eq(capturePreferences.vaultId, vault.id));
    return { weeklyEnabled: p?.weeklyEnabled ?? false, weekday: p?.weekday ?? 0 };
  }

  async setPreferences(userId: string, input: CapturePreferences, ipHash: string | null): Promise<CapturePreferences> {
    const { vault } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    await this.ctx.db
      .insert(capturePreferences)
      .values({ vaultId: vault.id, weeklyEnabled: input.weeklyEnabled, weekday: input.weekday })
      .onConflictDoUpdate({ target: capturePreferences.vaultId, set: { weeklyEnabled: input.weeklyEnabled, weekday: input.weekday, updatedAt: this.ctx.now() } });
    await writeAudit(this.ctx.db, { actorId: userId, action: "capture.preferences_updated", targetType: "vault", targetId: vault.id, ipHash, metadata: { weekly: input.weeklyEnabled } });
    return input;
  }

  // ---------------------------------------------------------------------------
  // Family suggestions
  // ---------------------------------------------------------------------------

  /** Accepted beneficiary of a vault that is still being built (the legator is alive). */
  private async beneficiaryAccess(userId: string, vaultId: string) {
    const [row] = await this.ctx.db
      .select({ beneficiary: vaultBeneficiaries, vault: legacyVaults })
      .from(vaultBeneficiaries)
      .innerJoin(legacyVaults, eq(legacyVaults.id, vaultBeneficiaries.vaultId))
      .where(and(eq(vaultBeneficiaries.vaultId, vaultId), eq(vaultBeneficiaries.userId, userId), eq(vaultBeneficiaries.status, "accepted")));
    if (!row || row.vault.status !== "building") throw notFound();
    return { ...row, cipher: new VaultCipher(await this.vaults.dekFor(row.vault)) };
  }

  async suggest(userId: string, vaultId: string, text: string, ipHash: string | null) {
    const { vault, beneficiary, cipher } = await this.beneficiaryAccess(userId, vaultId);
    const [open] = await this.ctx.db
      .select({ n: count() })
      .from(questionSuggestions)
      .where(and(eq(questionSuggestions.beneficiaryId, beneficiary.id), inArray(questionSuggestions.status, ["pending", "accepted"])));
    if ((open?.n ?? 0) >= SUGGESTION_MAX_OPEN) throw conflict("limit_reached");
    const id = randomUUID();
    await this.ctx.db.insert(questionSuggestions).values({ id, vaultId: vault.id, beneficiaryId: beneficiary.id, textEnc: cipher.encrypt(text, aad.suggestion(id)) });
    await writeAudit(this.ctx.db, { actorId: userId, action: "capture.suggestion_created", targetType: "suggestion", targetId: id, ipHash });
    const legator = await this.legatorOf(vault);
    const from = cipher.decrypt(beneficiary.nameEnc, aad.beneficiaryName(beneficiary.id));
    await this.ctx.mailer
      .send(captureEmails.suggestionReceived(legator.email, legator.locale, from, new URL(`/${legator.locale}/app/capture`, this.ctx.env.WEB_ORIGIN).toString()))
      .catch((err: Error) => this.ctx.log.warn({ err: err.message }, "suggestion email failed"));
    return { id, text, status: "pending" as const };
  }

  /** The suggester sees only their own suggestions and a status, never the answer. */
  async mySuggestions(userId: string, vaultId: string) {
    const { beneficiary, cipher } = await this.beneficiaryAccess(userId, vaultId);
    const rows = await this.ctx.db
      .select()
      .from(questionSuggestions)
      .where(eq(questionSuggestions.beneficiaryId, beneficiary.id))
      .orderBy(desc(questionSuggestions.createdAt));
    return rows.map((s) => ({ id: s.id, text: cipher.decrypt(s.textEnc, aad.suggestion(s.id)), status: s.status, createdAt: s.createdAt }));
  }

  async listSuggestions(userId: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const rows = await this.ctx.db
      .select({ s: questionSuggestions, b: vaultBeneficiaries })
      .from(questionSuggestions)
      .innerJoin(vaultBeneficiaries, eq(vaultBeneficiaries.id, questionSuggestions.beneficiaryId))
      .where(eq(questionSuggestions.vaultId, vault.id))
      .orderBy(desc(questionSuggestions.createdAt));
    return rows.map(({ s, b }) => ({
      id: s.id,
      text: cipher.decrypt(s.textEnc, aad.suggestion(s.id)),
      status: s.status,
      from: cipher.decrypt(b.nameEnc, aad.beneficiaryName(b.id)),
      relation: b.relation,
      createdAt: s.createdAt,
    }));
  }

  async decideSuggestion(userId: string, id: string, decision: "accepted" | "dismissed", ipHash: string | null): Promise<void> {
    const { vault } = await this.vaults.getOwned(userId);
    const rows = await this.ctx.db
      .update(questionSuggestions)
      .set({ status: decision, updatedAt: this.ctx.now() })
      .where(and(eq(questionSuggestions.id, id), eq(questionSuggestions.vaultId, vault.id), inArray(questionSuggestions.status, ["pending", "accepted", "dismissed"])))
      .returning({ id: questionSuggestions.id });
    if (rows.length === 0) throw notFound();
    await writeAudit(this.ctx.db, {
      actorId: userId,
      action: decision === "accepted" ? "capture.suggestion_accepted" : "capture.suggestion_dismissed",
      targetType: "suggestion",
      targetId: id,
      ipHash,
    });
  }

  // ---------------------------------------------------------------------------
  // Public: whoever holds the link (no account)
  // ---------------------------------------------------------------------------

  private async resolve(token: string) {
    const [row] = await this.ctx.db
      .select({ link: captureLinks, vault: legacyVaults })
      .from(captureLinks)
      .innerJoin(legacyVaults, eq(legacyVaults.id, captureLinks.vaultId))
      .where(eq(captureLinks.tokenHash, sha256(token)));
    if (!row || this.status(row.link) !== "active" || row.vault.status !== "building") throw invalidToken();
    return { ...row, cipher: new VaultCipher(await this.vaults.dekFor(row.vault)) };
  }

  /** What the capture page shows: the question and the legator's display name. Nothing else. */
  async session(token: string, locale: Locale) {
    const { link, vault, cipher } = await this.resolve(token);
    const legator = await this.legatorOf(vault);
    return { question: this.questionText(link, cipher, locale), name: legator.displayName, expiresAt: link.expiresAt };
  }

  /** Atomically marks the link used; fails if it was used, revoked or expired meanwhile. */
  private async claim(db: Pick<AppContext["db"], "update">, linkId: string): Promise<void> {
    const now = this.ctx.now();
    const rows = await db
      .update(captureLinks)
      .set({ usedAt: now })
      .where(and(eq(captureLinks.id, linkId), isNull(captureLinks.usedAt), isNull(captureLinks.revokedAt), gt(captureLinks.expiresAt, now)))
      .returning({ id: captureLinks.id });
    if (rows.length === 0) throw invalidToken();
  }

  async answerText(token: string, text: string, ipHash: string | null) {
    const { link, vault, cipher } = await this.resolve(token);
    const legator = await this.legatorOf(vault);
    const now = this.ctx.now();
    await this.ctx.db.transaction(async (tx) => {
      await this.claim(tx, link.id);
      if (link.source === "catalog" && link.questionId) {
        const [existing] = await tx
          .select({ id: guidedAnswers.id })
          .from(guidedAnswers)
          .where(and(eq(guidedAnswers.vaultId, vault.id), eq(guidedAnswers.questionId, link.questionId)));
        const id = existing?.id ?? randomUUID();
        const textEnc = cipher.encrypt(text, aad.answer(id));
        await tx
          .insert(guidedAnswers)
          .values({ id, vaultId: vault.id, questionId: link.questionId, textEnc, captureLinkId: link.id, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({ target: [guidedAnswers.vaultId, guidedAnswers.questionId], set: { textEnc, captureLinkId: link.id, updatedAt: now } });
      } else {
        const id = randomUUID();
        const question = this.questionText(link, cipher, legator.locale);
        await tx.insert(interviewEntries).values({
          id,
          vaultId: vault.id,
          sittingId: randomUUID(),
          topicId: null,
          questionEnc: cipher.encrypt(question, aad.interviewQ(id)),
          answerEnc: cipher.encrypt(text, aad.interviewA(id)),
          captureLinkId: link.id,
        });
      }
      if (link.suggestionId) await tx.update(questionSuggestions).set({ status: "answered", updatedAt: now }).where(eq(questionSuggestions.id, link.suggestionId));
    });
    await writeAudit(this.ctx.db, { actorId: null, action: "capture.link_used", targetType: "capture_link", targetId: link.id, ipHash, metadata: { kind: "text" } });
    return { status: "saved" as const };
  }

  /** A voice answer: goes through the normal media pipeline (quarantine → type check → ClamAV → transcription). */
  async answerAudio(token: string, body: Readable, contentType: string | undefined, contentLength: number | undefined, ipHash: string | null) {
    const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_CONTENT_TYPES.audio.includes(mime)) throw new AppError(415, "unsupported_media_type");
    if (!contentLength || contentLength <= 0 || contentLength > CAPTURE_AUDIO_MAX_BYTES) throw badRequest("file_too_large");
    const { link, vault, cipher } = await this.resolve(token);
    const legator = await this.legatorOf(vault);
    await this.claim(this.ctx.db, link.id);
    let mediaId: string | null = null;
    try {
      const label = this.questionText(link, cipher, legator.locale).slice(0, 200);
      const created = await this.media.create(vault.legatorUserId, { kind: "audio", contentType: mime, sizeBytes: contentLength, label }, ipHash, { captureLinkId: link.id });
      mediaId = created.id;
      await this.media.upload(vault.legatorUserId, created.id, body, mime, contentLength, ipHash);
    } catch (err) {
      // Give the link back so the person can try again; drop the half-made reservation.
      await this.ctx.db.update(captureLinks).set({ usedAt: null }).where(eq(captureLinks.id, link.id));
      if (mediaId) await this.ctx.db.delete(mediaAssets).where(and(eq(mediaAssets.id, mediaId), or(eq(mediaAssets.status, "awaiting_upload"), eq(mediaAssets.status, "uploading"))));
      throw err;
    }
    if (link.suggestionId) {
      await this.ctx.db.update(questionSuggestions).set({ status: "answered", updatedAt: this.ctx.now() }).where(eq(questionSuggestions.id, link.suggestionId));
    }
    await writeAudit(this.ctx.db, { actorId: null, action: "capture.link_used", targetType: "capture_link", targetId: link.id, ipHash, metadata: { kind: "audio" } });
    return { status: "saved" as const };
  }

  // ---------------------------------------------------------------------------
  // Worker: the weekly question
  // ---------------------------------------------------------------------------

  async sendWeekly(): Promise<number> {
    const today = isoDateInTimeZone(this.ctx.now(), this.ctx.env.SCHEDULE_TIMEZONE);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const due = await this.ctx.db
      .select({ p: capturePreferences, vault: legacyVaults })
      .from(capturePreferences)
      .innerJoin(legacyVaults, eq(legacyVaults.id, capturePreferences.vaultId))
      .where(
        and(
          eq(capturePreferences.weeklyEnabled, true),
          eq(capturePreferences.weekday, weekday),
          eq(legacyVaults.status, "building"),
          or(isNull(capturePreferences.lastSentOn), lte(capturePreferences.lastSentOn, isoFromOffset(today, -1))),
        ),
      );
    let sent = 0;
    for (const { p, vault } of due) {
      // Claim today's send first (idempotent across concurrent workers / reruns).
      const claimed = await this.ctx.db
        .update(capturePreferences)
        .set({ lastSentOn: today, updatedAt: this.ctx.now() })
        .where(and(eq(capturePreferences.vaultId, p.vaultId), or(isNull(capturePreferences.lastSentOn), lte(capturePreferences.lastSentOn, isoFromOffset(today, -1)))))
        .returning({ id: capturePreferences.vaultId });
      if (claimed.length === 0) continue;
      const cipher = new VaultCipher(await this.vaults.dekFor(vault));
      // Family questions the legator accepted come first.
      const [suggestion] = await this.ctx.db
        .select()
        .from(questionSuggestions)
        .where(
          and(
            eq(questionSuggestions.vaultId, vault.id),
            eq(questionSuggestions.status, "accepted"),
            // not already waiting behind an active link
            isNull(
              this.ctx.db
                .select({ id: captureLinks.id })
                .from(captureLinks)
                .where(and(eq(captureLinks.suggestionId, questionSuggestions.id), this.activeLinkWhere(vault.id)))
                .limit(1),
            ),
          ),
        )
        .orderBy(asc(questionSuggestions.createdAt))
        .limit(1);
      let q: Parameters<CaptureService["issue"]>[2] | null = null;
      if (suggestion) q = { source: "suggestion", suggestionId: suggestion.id, text: cipher.decrypt(suggestion.textEnc, aad.suggestion(suggestion.id)) };
      else {
        const questionId = await this.nextCatalogQuestion(vault.id);
        if (questionId) q = { source: "catalog", questionId };
      }
      if (!q) continue;
      const legator = await this.legatorOf(vault);
      const { row, token } = await this.issue(vault, cipher, q, "weekly");
      try {
        await this.ctx.mailer.send(
          captureEmails.questionLink(legator.email, legator.locale, this.questionText(row, cipher, legator.locale), this.linkUrl(legator.locale, token), CAPTURE_LINK_DAYS, true),
        );
        sent++;
      } catch (err) {
        this.ctx.log.warn({ err: (err as Error).message }, "weekly question email failed");
      }
    }
    return sent;
  }
}

function isoFromOffset(iso: string, days: number): string {
  return new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
