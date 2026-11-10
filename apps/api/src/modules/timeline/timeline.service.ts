import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { TIMELINE_LIMIT, compareTimeline, isoDateInTimeZone, type TimelineEvent, type TimelineEventInput } from "@inother/shared";
import type { AppContext } from "../../context.js";
import { legacyVaults, mediaAssets, sealedStories, timelineEvents } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import type { VaultCipher } from "../../lib/crypto/keys.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import type { VaultService } from "../vault/vault.service.js";

type VaultRow = typeof legacyVaults.$inferSelect;
const aad = {
  title: (id: string) => `timeline.title:${id}`,
  description: (id: string) => `timeline.description:${id}`,
  date: (id: string) => `timeline.date:${id}`,
};

/**
 * Decrypts and sorts a vault's timeline. `visible` (beneficiaries) limits which linked stories and
 * media are revealed; the event itself (title, date, description) is shown to every beneficiary.
 */
export async function loadTimeline(
  ctx: AppContext,
  vault: VaultRow,
  cipher: VaultCipher,
  visible?: { storyIds: Set<string>; mediaIds: Set<string> },
): Promise<TimelineEvent[]> {
  const rows = await ctx.db.select().from(timelineEvents).where(eq(timelineEvents.vaultId, vault.id));
  return rows
    .map((r) => ({
      id: r.id,
      title: cipher.decrypt(r.titleEnc, aad.title(r.id)),
      date: cipher.decrypt(r.dateEnc, aad.date(r.id)),
      description: r.descriptionEnc ? cipher.decrypt(r.descriptionEnc, aad.description(r.id)) : null,
      storyId: r.storyId && (!visible || visible.storyIds.has(r.storyId)) ? r.storyId : null,
      mediaId: r.mediaId && (!visible || visible.mediaIds.has(r.mediaId)) ? r.mediaId : null,
    }))
    .sort(compareTimeline);
}

export class TimelineService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
  ) {}

  async list(userId: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    return loadTimeline(this.ctx, vault, cipher);
  }

  private async validate(vault: VaultRow, input: TimelineEventInput): Promise<void> {
    // Compare at the event's own precision: "2026" is fine during 2026.
    const today = isoDateInTimeZone(this.ctx.now(), this.ctx.env.SCHEDULE_TIMEZONE);
    if (input.date > today.slice(0, input.date.length)) throw badRequest("date_in_future");
    if (input.storyId) {
      const [s] = await this.ctx.db.select({ id: sealedStories.id }).from(sealedStories).where(and(eq(sealedStories.id, input.storyId), eq(sealedStories.vaultId, vault.id)));
      if (!s) throw badRequest("unknown_story");
    }
    if (input.mediaId) {
      const [m] = await this.ctx.db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, input.mediaId), eq(mediaAssets.vaultId, vault.id), eq(mediaAssets.status, "clean")));
      if (!m) throw badRequest("invalid_media");
    }
  }

  private columns(id: string, input: TimelineEventInput, cipher: VaultCipher) {
    return {
      titleEnc: cipher.encrypt(input.title, aad.title(id)),
      descriptionEnc: input.description ? cipher.encrypt(input.description, aad.description(id)) : null,
      dateEnc: cipher.encrypt(input.date, aad.date(id)),
      storyId: input.storyId,
      mediaId: input.mediaId,
    };
  }

  async create(userId: string, input: TimelineEventInput, ipHash: string | null): Promise<TimelineEvent> {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    await this.validate(vault, input);
    const [n] = await this.ctx.db.select({ n: count() }).from(timelineEvents).where(eq(timelineEvents.vaultId, vault.id));
    if ((n?.n ?? 0) >= TIMELINE_LIMIT) throw conflict("limit_reached");
    const id = randomUUID();
    await this.ctx.db.insert(timelineEvents).values({ id, vaultId: vault.id, ...this.columns(id, input, cipher) });
    await writeAudit(this.ctx.db, { actorId: userId, action: "timeline.created", targetType: "timeline_event", targetId: id, ipHash });
    return { id, ...input };
  }

  async update(userId: string, id: string, input: TimelineEventInput, ipHash: string | null): Promise<TimelineEvent> {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    await this.validate(vault, input);
    const rows = await this.ctx.db
      .update(timelineEvents)
      .set({ ...this.columns(id, input, cipher), updatedAt: this.ctx.now() })
      .where(and(eq(timelineEvents.id, id), eq(timelineEvents.vaultId, vault.id)))
      .returning({ id: timelineEvents.id });
    if (rows.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "timeline.updated", targetType: "timeline_event", targetId: id, ipHash });
    return { id, ...input };
  }

  async delete(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const rows = await this.ctx.db
      .delete(timelineEvents)
      .where(and(eq(timelineEvents.id, id), eq(timelineEvents.vaultId, vault.id)))
      .returning({ id: timelineEvents.id });
    if (rows.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "timeline.deleted", targetType: "timeline_event", targetId: id, ipHash });
  }
}
