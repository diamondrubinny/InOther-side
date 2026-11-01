import { and, eq, isNull, sql } from "drizzle-orm";
import { DEFAULT_LOCALE, isLocale } from "@inother/shared";
import type { AppContext } from "../../context.js";
import { consents, legacyVaults, mediaAssets, mediaTranscripts, users } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { VaultCipher } from "../../lib/crypto/keys.js";
import { createDecryptStream } from "../../lib/crypto/stream.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { mediaKeys } from "../../lib/storage.js";
import type { VaultService } from "../vault/vault.service.js";
import { mediaAad, readAll } from "./media.service.js";

/** Larger files are not sent for transcription (most self-hosted servers cap request size). */
export const MAX_TRANSCRIBE_BYTES = 500 * 1024 * 1024;
const transcriptAad = (mediaId: string) => `media.transcript:${mediaId}`;

/**
 * Transcribes the legator's own clean audio/video recordings (only with AI-processing consent).
 * Transcripts are encrypted with the vault key, editable by the legator, and feed the persona.
 */
export class TranscriptionService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
  ) {}

  private async consented(legatorUserId: string): Promise<boolean> {
    const [c] = await this.ctx.db
      .select({ id: consents.id })
      .from(consents)
      .where(and(eq(consents.userId, legatorUserId), eq(consents.purpose, "ai_processing"), isNull(consents.withdrawnAt)));
    return Boolean(c);
  }

  /** Worker entry point. Returns the outcome; throws on transient failure so the queue retries. */
  async process(mediaId: string): Promise<"done" | "skipped"> {
    const transcriber = this.ctx.transcriber;
    if (!transcriber) return "skipped";
    const [m] = await this.ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId));
    if (!m || m.status !== "clean" || (m.kind !== "audio" && m.kind !== "video")) return "skipped";
    if ((m.sizeBytes ?? 0) > MAX_TRANSCRIBE_BYTES) return "skipped";
    const [row] = await this.ctx.db
      .select({ vault: legacyVaults, locale: users.locale })
      .from(legacyVaults)
      .innerJoin(users, eq(users.id, legacyVaults.legatorUserId))
      .where(eq(legacyVaults.id, m.vaultId));
    if (!row || !(await this.consented(row.vault.legatorUserId))) return "skipped";
    const [existing] = await this.ctx.db.select().from(mediaTranscripts).where(eq(mediaTranscripts.mediaId, mediaId));
    if (existing?.editedByLegator) return "skipped"; // never overwrite the legator's own corrections

    const now = this.ctx.now();
    await this.ctx.db
      .insert(mediaTranscripts)
      .values({ mediaId, vaultId: m.vaultId, status: "pending", attempts: 1, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: mediaTranscripts.mediaId, set: { status: "pending", attempts: sql`${mediaTranscripts.attempts} + 1`, updatedAt: now } });

    const dek = await this.vaults.dekFor(row.vault);
    const src = await this.ctx.storage.get(mediaKeys.content(m.vaultId, m.id));
    const dec = createDecryptStream(dek, mediaAad.content(m.id));
    src.on("error", (e) => dec.destroy(e));
    const audio = await readAll(src.pipe(dec));
    const language = isLocale(row.locale) ? row.locale : DEFAULT_LOCALE;
    try {
      const result = await transcriber.transcribe(audio, m.detectedMime ?? m.declaredMime, language);
      const cipher = new VaultCipher(dek);
      await this.ctx.db
        .update(mediaTranscripts)
        .set({ status: "done", textEnc: cipher.encrypt(result.text, transcriptAad(m.id)), language: result.language, updatedAt: this.ctx.now() })
        .where(eq(mediaTranscripts.mediaId, mediaId));
      await writeAudit(this.ctx.db, { actorId: null, action: "media.transcribed", targetType: "media", targetId: mediaId, metadata: { transcriber: transcriber.name } });
      return "done";
    } catch (err) {
      await this.ctx.db.update(mediaTranscripts).set({ status: "failed", updatedAt: this.ctx.now() }).where(eq(mediaTranscripts.mediaId, mediaId));
      this.ctx.log.error({ err, mediaId }, "transcription failed");
      throw err;
    }
  }

  private async owned(userId: string, mediaId: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const [m] = await this.ctx.db.select().from(mediaAssets).where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.vaultId, vault.id)));
    if (!m) throw notFound();
    return { vault, cipher, media: m };
  }

  async get(userId: string, mediaId: string) {
    const { cipher } = await this.owned(userId, mediaId);
    const [t] = await this.ctx.db.select().from(mediaTranscripts).where(eq(mediaTranscripts.mediaId, mediaId));
    if (!t) return { status: "none" as const, text: null, editedByLegator: false };
    return {
      status: t.status,
      text: t.textEnc ? cipher.decrypt(t.textEnc, transcriptAad(mediaId)) : null,
      editedByLegator: t.editedByLegator,
    };
  }

  /** The legator corrects the transcript; corrected text is never overwritten automatically. */
  async update(userId: string, mediaId: string, text: string, ipHash: string | null) {
    const { vault, cipher, media } = await this.owned(userId, mediaId);
    this.vaults.assertEditable(vault);
    if (media.kind !== "audio" && media.kind !== "video") throw conflict("not_a_recording");
    const now = this.ctx.now();
    const textEnc = cipher.encrypt(text, transcriptAad(mediaId));
    await this.ctx.db
      .insert(mediaTranscripts)
      .values({ mediaId, vaultId: vault.id, status: "done", textEnc, editedByLegator: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: mediaTranscripts.mediaId, set: { status: "done", textEnc, editedByLegator: true, updatedAt: now } });
    await writeAudit(this.ctx.db, { actorId: userId, action: "media.transcript_edited", targetType: "media", targetId: mediaId, ipHash });
    return this.get(userId, mediaId);
  }

  async retry(userId: string, mediaId: string) {
    const { media } = await this.owned(userId, mediaId);
    if (!this.ctx.transcriber) throw new AppError(503, "transcription_unavailable");
    if (media.status !== "clean" || (media.kind !== "audio" && media.kind !== "video")) throw conflict("not_a_recording");
    await this.ctx.db.update(mediaTranscripts).set({ editedByLegator: false }).where(eq(mediaTranscripts.mediaId, mediaId));
    await this.ctx.mediaQueue.enqueueTranscribe(mediaId);
    return this.get(userId, mediaId);
  }

  async delete(userId: string, mediaId: string, ipHash: string | null): Promise<void> {
    await this.owned(userId, mediaId);
    await this.ctx.db.delete(mediaTranscripts).where(eq(mediaTranscripts.mediaId, mediaId));
    await writeAudit(this.ctx.db, { actorId: userId, action: "media.transcript_deleted", targetType: "media", targetId: mediaId, ipHash });
  }
}
