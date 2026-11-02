import type { Readable } from "node:stream";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { findQuestion, type Locale } from "@inother/shared";
import type { AppContext } from "../../context.js";
import {
  guidedAnswers,
  legacyVaults,
  mediaAssets,
  sealedStories,
  storyAudienceMembers,
  users,
  vaultBeneficiaries,
} from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { VaultCipher } from "../../lib/crypto/keys.js";
import { createDecryptStream } from "../../lib/crypto/stream.js";
import { notFound } from "../../lib/errors.js";
import { mediaKeys } from "../../lib/storage.js";
import { mediaAad } from "../media/media.service.js";
import { deliveredMediaIds, messageMediaIds } from "../messages/messages.service.js";
import type { VaultService } from "../vault/vault.service.js";

const aad = (table: string, column: string, id: string) => `${table}.${column}:${id}`;

type StoryRow = typeof sealedStories.$inferSelect;

/**
 * Read-only access for beneficiaries to a RELEASED vault, filtered by the legator's rules:
 *  - stories: audience "all" or the beneficiary is listed; release "on_release", or "date" that has
 *    arrived. "on_topic" stories are reserved for the future conversation feature and not listed.
 *  - media: clean files that are unattached or attached to a visible story.
 * Any other caller gets 404 (no hint whether the vault exists).
 */
export class InheritanceService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
  ) {}

  async list(userId: string) {
    const rows = await this.ctx.db
      .select({ vaultId: legacyVaults.id, status: legacyVaults.status, legatorName: users.displayName, acceptedAt: vaultBeneficiaries.acceptedAt })
      .from(vaultBeneficiaries)
      .innerJoin(legacyVaults, eq(legacyVaults.id, vaultBeneficiaries.vaultId))
      .innerJoin(users, eq(users.id, legacyVaults.legatorUserId))
      .where(and(eq(vaultBeneficiaries.userId, userId), eq(vaultBeneficiaries.status, "accepted")));
    // Before release only the fact of being chosen is shown (the legator chose to tell them).
    return rows.map((r) => ({
      vaultId: r.vaultId,
      legatorName: r.legatorName,
      released: r.status === "released",
      /** The legator is alive and still building: family may suggest questions. */
      canSuggest: r.status === "building",
    }));
  }

  private async access(userId: string, vaultId: string) {
    const [row] = await this.ctx.db
      .select({ beneficiaryId: vaultBeneficiaries.id, vault: legacyVaults, legatorName: users.displayName })
      .from(vaultBeneficiaries)
      .innerJoin(legacyVaults, eq(legacyVaults.id, vaultBeneficiaries.vaultId))
      .innerJoin(users, eq(users.id, legacyVaults.legatorUserId))
      .where(and(eq(vaultBeneficiaries.vaultId, vaultId), eq(vaultBeneficiaries.userId, userId), eq(vaultBeneficiaries.status, "accepted")));
    if (!row || row.vault.status !== "released") throw notFound();
    return { ...row, cipher: new VaultCipher(await this.vaults.dekFor(row.vault)) };
  }

  private async visibleStories(vaultId: string, beneficiaryId: string): Promise<StoryRow[]> {
    const today = this.ctx.now().toISOString().slice(0, 10);
    const rows = await this.ctx.db.select().from(sealedStories).where(eq(sealedStories.vaultId, vaultId)).orderBy(asc(sealedStories.createdAt));
    const specificIds = rows.filter((r) => r.audience === "specific").map((r) => r.id);
    const mine = specificIds.length
      ? new Set(
          (
            await this.ctx.db
              .select({ storyId: storyAudienceMembers.storyId })
              .from(storyAudienceMembers)
              .where(and(inArray(storyAudienceMembers.storyId, specificIds), eq(storyAudienceMembers.beneficiaryId, beneficiaryId)))
          ).map((r) => r.storyId),
        )
      : new Set<string>();
    return rows.filter(
      (r) =>
        (r.audience === "all" || mine.has(r.id)) &&
        (r.releaseRule === "on_release" || (r.releaseRule === "date" && r.releaseAt !== null && r.releaseAt <= today)),
    );
  }

  async summary(userId: string, vaultId: string, ipHash: string | null) {
    const { vault, cipher, legatorName, beneficiaryId } = await this.access(userId, vaultId);
    const stories = await this.visibleStories(vault.id, beneficiaryId);
    await writeAudit(this.ctx.db, { actorId: userId, action: "inheritance.viewed", targetType: "vault", targetId: vault.id, ipHash });
    return {
      vaultId: vault.id,
      legatorName,
      openingMessage: vault.openingMessageEnc ? cipher.decrypt(vault.openingMessageEnc, aad("vault", "opening_message", vault.id)) : null,
      counts: { stories: stories.length },
    };
  }

  async answers(userId: string, vaultId: string, locale: Locale) {
    const { vault, cipher } = await this.access(userId, vaultId);
    const rows = await this.ctx.db.select().from(guidedAnswers).where(eq(guidedAnswers.vaultId, vault.id));
    return rows.map((r) => ({
      questionId: r.questionId,
      question: findQuestion(r.questionId)?.text[locale] ?? null,
      text: cipher.decrypt(r.textEnc, aad("answer", "text", r.id)),
    }));
  }

  async stories(userId: string, vaultId: string) {
    const { vault, cipher, beneficiaryId } = await this.access(userId, vaultId);
    const rows = await this.visibleStories(vault.id, beneficiaryId);
    return rows.map((r) => ({
      id: r.id,
      title: cipher.decrypt(r.titleEnc, aad("story", "title", r.id)),
      body: cipher.decrypt(r.bodyEnc, aad("story", "body", r.id)),
      delivery: r.delivery,
    }));
  }

  private async visibleMedia(vaultId: string, beneficiaryId: string) {
    const storyIds = (await this.visibleStories(vaultId, beneficiaryId)).map((s) => s.id);
    // Files attached to scheduled messages stay hidden until that message reached this beneficiary.
    const [attached, delivered] = await Promise.all([messageMediaIds(this.ctx.db, vaultId), deliveredMediaIds(this.ctx.db, vaultId, beneficiaryId)]);
    const rows = await this.ctx.db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.vaultId, vaultId),
          eq(mediaAssets.status, "clean"),
          storyIds.length ? or(isNull(mediaAssets.storyId), inArray(mediaAssets.storyId, storyIds)) : isNull(mediaAssets.storyId),
        ),
      )
      .orderBy(asc(mediaAssets.createdAt));
    return rows.filter((r) => !attached.has(r.id) || delivered.has(r.id));
  }

  async media(userId: string, vaultId: string) {
    const { vault, cipher, beneficiaryId } = await this.access(userId, vaultId);
    const rows = await this.visibleMedia(vault.id, beneficiaryId);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      contentType: r.detectedMime ?? r.declaredMime,
      sizeBytes: r.sizeBytes ?? r.declaredSize,
      label: r.labelEnc ? cipher.decrypt(r.labelEnc, mediaAad.label(r.id)) : null,
      storyId: r.storyId,
    }));
  }

  async mediaContent(userId: string, vaultId: string, mediaId: string): Promise<{ stream: Readable; mime: string; size: number }> {
    const { vault, beneficiaryId } = await this.access(userId, vaultId);
    const row = (await this.visibleMedia(vault.id, beneficiaryId)).find((m) => m.id === mediaId);
    if (!row) throw notFound();
    const dek = await this.vaults.dekFor(vault);
    const src = await this.ctx.storage.get(mediaKeys.content(vault.id, row.id));
    const dec = createDecryptStream(dek, mediaAad.content(row.id));
    src.on("error", (e) => dec.destroy(e));
    return { stream: src.pipe(dec), mime: row.detectedMime ?? row.declaredMime, size: row.sizeBytes ?? 0 };
  }
}
