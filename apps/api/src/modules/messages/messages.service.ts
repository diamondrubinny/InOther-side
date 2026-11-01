import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import {
  DEFAULT_LOCALE,
  fixedFromIso,
  isLocale,
  isoDateInTimeZone,
  isoFromFixed,
  messageTriggerSchema,
  nextOccurrence,
  triggerNeedsBirthDate,
  type MessageTrigger,
  type ScheduleContext,
  type ScheduledMessageInput,
} from "@inother/shared";
import type { AppContext } from "../../context.js";
import type { DbExecutor } from "../../db/client.js";
import {
  legacyVaults,
  mediaAssets,
  messageDeliveries,
  releaseRequests,
  scheduledMessageRecipients,
  scheduledMessages,
  users,
  vaultBeneficiaries,
} from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { VaultCipher } from "../../lib/crypto/keys.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import type { VaultService } from "../vault/vault.service.js";
import { messageEmails } from "./emails.js";

export const MESSAGE_LIMIT = 300;

const aad = {
  title: (id: string) => `message.title:${id}`,
  body: (id: string) => `message.body:${id}`,
  trigger: (id: string) => `message.trigger:${id}`,
  birthDate: (id: string) => `beneficiary.birth_date:${id}`,
  email: (id: string) => `beneficiary.email:${id}`,
};

type VaultRow = typeof legacyVaults.$inferSelect;
type MessageRow = typeof scheduledMessages.$inferSelect;
type BeneficiaryRow = typeof vaultBeneficiaries.$inferSelect;

/** Media attached to any scheduled message of the vault: hidden everywhere until delivered. */
export async function messageMediaIds(db: DbExecutor, vaultId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: scheduledMessages.mediaId })
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.vaultId, vaultId), isNotNull(scheduledMessages.mediaId)));
  return new Set(rows.map((r) => r.id as string));
}

/** Attached media of messages already delivered (and not held) to this beneficiary. */
export async function deliveredMediaIds(db: DbExecutor, vaultId: string, beneficiaryId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: scheduledMessages.mediaId })
    .from(messageDeliveries)
    .innerJoin(scheduledMessages, eq(scheduledMessages.id, messageDeliveries.messageId))
    .where(
      and(
        eq(scheduledMessages.vaultId, vaultId),
        eq(messageDeliveries.beneficiaryId, beneficiaryId),
        eq(messageDeliveries.held, false),
        isNotNull(scheduledMessages.mediaId),
      ),
    );
  return new Set(rows.map((r) => r.id as string));
}

/**
 * Letters the legator schedules for after release: on dates, Hebrew-calendar anniversaries,
 * holidays, ages, or life events the recipient opens ("open when..."). See docs/SCHEDULED-MESSAGES.md.
 */
export class MessagesService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
  ) {}

  private today(): string {
    return isoDateInTimeZone(this.ctx.now(), this.ctx.env.SCHEDULE_TIMEZONE);
  }

  private decryptTrigger(m: MessageRow, cipher: VaultCipher): MessageTrigger {
    return messageTriggerSchema.parse(JSON.parse(cipher.decrypt(m.triggerEnc, aad.trigger(m.id))));
  }

  // ---------------------------------------------------------------------------
  // Legator
  // ---------------------------------------------------------------------------

  private async recipientsOf(messageIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (messageIds.length === 0) return map;
    const rows = await this.ctx.db
      .select({ messageId: scheduledMessageRecipients.messageId, beneficiaryId: scheduledMessageRecipients.beneficiaryId })
      .from(scheduledMessageRecipients)
      .where(inArray(scheduledMessageRecipients.messageId, messageIds));
    for (const r of rows) map.set(r.messageId, [...(map.get(r.messageId) ?? []), r.beneficiaryId]);
    return map;
  }

  async list(userId: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const rows = await this.ctx.db.select().from(scheduledMessages).where(eq(scheduledMessages.vaultId, vault.id)).orderBy(asc(scheduledMessages.createdAt));
    const recipients = await this.recipientsOf(rows.map((r) => r.id));
    return rows.map((m) => ({
      id: m.id,
      title: cipher.decrypt(m.titleEnc, aad.title(m.id)),
      trigger: this.decryptTrigger(m, cipher),
      beneficiaryIds: recipients.get(m.id) ?? [],
      mediaId: m.mediaId,
      updatedAt: m.updatedAt,
    }));
  }

  async get(userId: string, id: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const [m] = await this.ctx.db.select().from(scheduledMessages).where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.vaultId, vault.id)));
    if (!m) throw notFound();
    const recipients = await this.recipientsOf([m.id]);
    return {
      id: m.id,
      title: cipher.decrypt(m.titleEnc, aad.title(m.id)),
      body: cipher.decrypt(m.bodyEnc, aad.body(m.id)),
      trigger: this.decryptTrigger(m, cipher),
      beneficiaryIds: recipients.get(m.id) ?? [],
      mediaId: m.mediaId,
      updatedAt: m.updatedAt,
    };
  }

  private async validate(db: DbExecutor, vault: VaultRow, input: ScheduledMessageInput): Promise<void> {
    const ids = [...new Set(input.beneficiaryIds)];
    const rows = await db
      .select({ id: vaultBeneficiaries.id, birthDateEnc: vaultBeneficiaries.birthDateEnc })
      .from(vaultBeneficiaries)
      .where(and(eq(vaultBeneficiaries.vaultId, vault.id), inArray(vaultBeneficiaries.id, ids)));
    if (rows.length !== ids.length) throw badRequest("invalid_beneficiary");
    if (triggerNeedsBirthDate(input.trigger) && rows.some((r) => !r.birthDateEnc)) throw badRequest("birth_date_required");
    if (input.mediaId) {
      const [media] = await db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, input.mediaId), eq(mediaAssets.vaultId, vault.id), eq(mediaAssets.status, "clean")));
      if (!media) throw badRequest("invalid_media");
    }
  }

  private columns(id: string, input: ScheduledMessageInput, cipher: VaultCipher) {
    return {
      titleEnc: cipher.encrypt(input.title, aad.title(id)),
      bodyEnc: cipher.encrypt(input.body, aad.body(id)),
      triggerEnc: cipher.encrypt(JSON.stringify(input.trigger), aad.trigger(id)),
      triggerKind: input.trigger.kind,
      mediaId: input.mediaId,
    };
  }

  async create(userId: string, input: ScheduledMessageInput, ipHash: string | null) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const [n] = await this.ctx.db.select({ n: count() }).from(scheduledMessages).where(eq(scheduledMessages.vaultId, vault.id));
    if ((n?.n ?? 0) >= MESSAGE_LIMIT) throw conflict("limit_reached");
    const id = randomUUID();
    await this.ctx.db.transaction(async (tx) => {
      await this.validate(tx, vault, input);
      await tx.insert(scheduledMessages).values({ id, vaultId: vault.id, ...this.columns(id, input, cipher) });
      await tx.insert(scheduledMessageRecipients).values([...new Set(input.beneficiaryIds)].map((beneficiaryId) => ({ messageId: id, beneficiaryId })));
    });
    await writeAudit(this.ctx.db, { actorId: userId, action: "message.created", targetType: "message", targetId: id, ipHash, metadata: { trigger: input.trigger.kind } });
    return this.get(userId, id);
  }

  async update(userId: string, id: string, input: ScheduledMessageInput, ipHash: string | null) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    await this.ctx.db.transaction(async (tx) => {
      const updated = await tx
        .update(scheduledMessages)
        .set({ ...this.columns(id, input, cipher), updatedAt: this.ctx.now() })
        .where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.vaultId, vault.id)))
        .returning({ id: scheduledMessages.id });
      if (updated.length === 0) throw notFound();
      await this.validate(tx, vault, input);
      await tx.delete(scheduledMessageRecipients).where(eq(scheduledMessageRecipients.messageId, id));
      await tx.insert(scheduledMessageRecipients).values([...new Set(input.beneficiaryIds)].map((beneficiaryId) => ({ messageId: id, beneficiaryId })));
    });
    await writeAudit(this.ctx.db, { actorId: userId, action: "message.updated", targetType: "message", targetId: id, ipHash });
    return this.get(userId, id);
  }

  async delete(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const deleted = await this.ctx.db
      .delete(scheduledMessages)
      .where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.vaultId, vault.id)))
      .returning({ id: scheduledMessages.id });
    if (deleted.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "message.deleted", targetType: "message", targetId: id, ipHash });
  }

  /** Portable export (included in the legator's data export). */
  async exportAll(userId: string) {
    const items = await this.list(userId);
    return Promise.all(items.map((m) => this.get(userId, m.id)));
  }

  // ---------------------------------------------------------------------------
  // Beneficiary (released vaults only; anyone else gets 404)
  // ---------------------------------------------------------------------------

  private async access(userId: string, vaultId: string) {
    const [row] = await this.ctx.db
      .select({ beneficiary: vaultBeneficiaries, vault: legacyVaults })
      .from(vaultBeneficiaries)
      .innerJoin(legacyVaults, eq(legacyVaults.id, vaultBeneficiaries.vaultId))
      .where(and(eq(vaultBeneficiaries.vaultId, vaultId), eq(vaultBeneficiaries.userId, userId), eq(vaultBeneficiaries.status, "accepted")));
    if (!row || row.vault.status !== "released") throw notFound();
    return { ...row, cipher: new VaultCipher(await this.vaults.dekFor(row.vault)) };
  }

  async inbox(userId: string, vaultId: string) {
    const { vault, beneficiary, cipher } = await this.access(userId, vaultId);
    const delivered = await this.ctx.db
      .select({ d: messageDeliveries, m: scheduledMessages })
      .from(messageDeliveries)
      .innerJoin(scheduledMessages, eq(scheduledMessages.id, messageDeliveries.messageId))
      .where(and(eq(scheduledMessages.vaultId, vault.id), eq(messageDeliveries.beneficiaryId, beneficiary.id), eq(messageDeliveries.held, false)))
      .orderBy(desc(messageDeliveries.occurrenceOn), desc(messageDeliveries.deliveredAt));
    const mine = await this.ctx.db
      .select({ r: scheduledMessageRecipients, m: scheduledMessages })
      .from(scheduledMessageRecipients)
      .innerJoin(scheduledMessages, eq(scheduledMessages.id, scheduledMessageRecipients.messageId))
      .where(and(eq(scheduledMessages.vaultId, vault.id), eq(scheduledMessageRecipients.beneficiaryId, beneficiary.id)));
    const pendingById = new Map(mine.filter((x) => x.r.status === "pending").map((x) => [x.m.id, x]));
    const [held] = await this.ctx.db
      .select({ n: count() })
      .from(messageDeliveries)
      .where(and(eq(messageDeliveries.beneficiaryId, beneficiary.id), eq(messageDeliveries.held, true)));

    return {
      paused: beneficiary.messagesPausedAt !== null,
      heldCount: held?.n ?? 0,
      delivered: delivered.map(({ d, m }) => ({
        id: d.id,
        messageId: m.id,
        title: cipher.decrypt(m.titleEnc, aad.title(m.id)),
        triggerKind: m.triggerKind,
        occurrenceOn: d.occurrenceOn,
        opened: d.openedAt !== null,
        hasMedia: m.mediaId !== null,
        /** A recurring message that will come again: the recipient may stop it. */
        canStop: pendingById.has(m.id) && m.triggerKind !== "life_event",
      })),
      // "Open when..." letters: only the event is shown, never the title or content.
      openWhen: mine
        .filter((x) => x.m.triggerKind === "life_event" && x.r.status === "pending")
        .map(({ m }) => {
          const t = this.decryptTrigger(m, cipher);
          return t.kind === "life_event" ? { messageId: m.id, event: t.event, label: t.label } : null;
        })
        .filter((x) => x !== null),
      // How many more will arrive in the future (no dates: keep the surprise, avoid dread).
      upcomingCount: mine.filter((x) => x.r.status === "pending" && x.m.triggerKind !== "life_event").length,
    };
  }

  async read(userId: string, vaultId: string, deliveryId: string, ipHash: string | null) {
    const { vault, beneficiary, cipher } = await this.access(userId, vaultId);
    const [row] = await this.ctx.db
      .select({ d: messageDeliveries, m: scheduledMessages, media: mediaAssets })
      .from(messageDeliveries)
      .innerJoin(scheduledMessages, eq(scheduledMessages.id, messageDeliveries.messageId))
      .leftJoin(mediaAssets, and(eq(mediaAssets.id, scheduledMessages.mediaId), eq(mediaAssets.status, "clean")))
      .where(
        and(
          eq(messageDeliveries.id, deliveryId),
          eq(messageDeliveries.beneficiaryId, beneficiary.id),
          eq(messageDeliveries.held, false),
          eq(scheduledMessages.vaultId, vault.id),
        ),
      );
    if (!row) throw notFound();
    if (!row.d.openedAt) {
      await this.ctx.db.update(messageDeliveries).set({ openedAt: this.ctx.now() }).where(eq(messageDeliveries.id, row.d.id));
      await writeAudit(this.ctx.db, { actorId: userId, action: "message.opened", targetType: "message", targetId: row.m.id, ipHash });
    }
    return {
      id: row.d.id,
      title: cipher.decrypt(row.m.titleEnc, aad.title(row.m.id)),
      body: cipher.decrypt(row.m.bodyEnc, aad.body(row.m.id)),
      occurrenceOn: row.d.occurrenceOn,
      triggerKind: row.m.triggerKind,
      media: row.media ? { id: row.media.id, kind: row.media.kind, contentType: row.media.detectedMime ?? row.media.declaredMime } : null,
    };
  }

  /** The recipient declares the life event ("I'm getting married") and opens the letter. */
  async openLifeEvent(userId: string, vaultId: string, messageId: string, ipHash: string | null) {
    const { vault, beneficiary } = await this.access(userId, vaultId);
    const today = this.today();
    const deliveryId = await this.ctx.db.transaction(async (tx) => {
      const claimed = await tx
        .update(scheduledMessageRecipients)
        .set({ status: "done", initialized: true, nextDueOn: null, updatedAt: this.ctx.now() })
        .where(
          and(
            eq(scheduledMessageRecipients.messageId, messageId),
            eq(scheduledMessageRecipients.beneficiaryId, beneficiary.id),
            eq(scheduledMessageRecipients.status, "pending"),
            inArray(
              scheduledMessageRecipients.messageId,
              tx
                .select({ id: scheduledMessages.id })
                .from(scheduledMessages)
                .where(and(eq(scheduledMessages.vaultId, vault.id), eq(scheduledMessages.triggerKind, "life_event"))),
            ),
          ),
        )
        .returning({ id: scheduledMessageRecipients.messageId });
      if (claimed.length === 0) throw notFound();
      // An explicit act by the recipient: delivered even while other messages are paused.
      const [d] = await tx
        .insert(messageDeliveries)
        .values({ messageId, beneficiaryId: beneficiary.id, occurrenceOn: today, held: false })
        .onConflictDoNothing()
        .returning({ id: messageDeliveries.id });
      if (d) return d.id;
      const [existing] = await tx
        .select({ id: messageDeliveries.id })
        .from(messageDeliveries)
        .where(and(eq(messageDeliveries.messageId, messageId), eq(messageDeliveries.beneficiaryId, beneficiary.id), eq(messageDeliveries.occurrenceOn, today)));
      return existing?.id as string;
    });
    await writeAudit(this.ctx.db, { actorId: userId, action: "message.event_opened", targetType: "message", targetId: messageId, ipHash });
    return { deliveryId };
  }

  /** Stop a recurring message (e.g. yearly yahrzeit letter) for this recipient. */
  async stop(userId: string, vaultId: string, messageId: string, ipHash: string | null): Promise<void> {
    const { vault, beneficiary } = await this.access(userId, vaultId);
    const stopped = await this.ctx.db
      .update(scheduledMessageRecipients)
      .set({ status: "stopped", nextDueOn: null, updatedAt: this.ctx.now() })
      .where(
        and(
          eq(scheduledMessageRecipients.messageId, messageId),
          eq(scheduledMessageRecipients.beneficiaryId, beneficiary.id),
          eq(scheduledMessageRecipients.status, "pending"),
          inArray(
            scheduledMessageRecipients.messageId,
            this.ctx.db
              .select({ id: scheduledMessages.id })
              .from(scheduledMessages)
              .where(and(eq(scheduledMessages.vaultId, vault.id), ne(scheduledMessages.triggerKind, "life_event"))),
          ),
        ),
      )
      .returning({ id: scheduledMessageRecipients.messageId });
    if (stopped.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "message.stopped", targetType: "message", targetId: messageId, ipHash });
  }

  /** "Not ready yet": deliveries keep being recorded but are held (hidden, no email) until resumed. */
  async setPaused(userId: string, vaultId: string, paused: boolean, ipHash: string | null) {
    const { beneficiary } = await this.access(userId, vaultId);
    await this.ctx.db
      .update(vaultBeneficiaries)
      .set({ messagesPausedAt: paused ? (beneficiary.messagesPausedAt ?? this.ctx.now()) : null, updatedAt: this.ctx.now() })
      .where(eq(vaultBeneficiaries.id, beneficiary.id));
    if (!paused) {
      await this.ctx.db.update(messageDeliveries).set({ held: false }).where(and(eq(messageDeliveries.beneficiaryId, beneficiary.id), eq(messageDeliveries.held, true)));
    }
    await writeAudit(this.ctx.db, {
      actorId: userId,
      action: paused ? "message.paused" : "message.resumed",
      targetType: "beneficiary",
      targetId: beneficiary.id,
      ipHash,
    });
    return { paused };
  }

  // ---------------------------------------------------------------------------
  // Scheduler (worker): initialize schedules of released vaults, deliver what is due
  // ---------------------------------------------------------------------------

  private async scheduleContext(vault: VaultRow, cipher: VaultCipher, b: BeneficiaryRow): Promise<ScheduleContext | null> {
    const [rel] = await this.ctx.db
      .select()
      .from(releaseRequests)
      .where(and(eq(releaseRequests.vaultId, vault.id), eq(releaseRequests.status, "released")))
      .orderBy(desc(releaseRequests.releasedAt))
      .limit(1);
    if (!rel?.releasedAt) return null;
    return {
      birthDate: b.birthDateEnc ? cipher.decrypt(b.birthDateEnc, aad.birthDate(b.id)) : null,
      bornAfterSunset: b.bornAfterSunset,
      deathDate: rel.dateOfDeath,
      deathAfterSunset: rel.deathAfterSunset,
      releaseDate: isoDateInTimeZone(rel.releasedAt, this.ctx.env.SCHEDULE_TIMEZONE),
    };
  }

  /** Runs the whole cycle. Idempotent and safe to run concurrently (conditional updates + unique deliveries). */
  async deliverDue(): Promise<{ initialized: number; delivered: number }> {
    const today = this.today();
    const due = await this.ctx.db
      .select({ r: scheduledMessageRecipients, m: scheduledMessages, b: vaultBeneficiaries, vault: legacyVaults })
      .from(scheduledMessageRecipients)
      .innerJoin(scheduledMessages, eq(scheduledMessages.id, scheduledMessageRecipients.messageId))
      .innerJoin(vaultBeneficiaries, eq(vaultBeneficiaries.id, scheduledMessageRecipients.beneficiaryId))
      .innerJoin(legacyVaults, eq(legacyVaults.id, scheduledMessages.vaultId))
      .where(and(eq(legacyVaults.status, "released"), eq(scheduledMessageRecipients.status, "pending")));

    const ciphers = new Map<string, VaultCipher>();
    const cipherFor = async (vault: VaultRow) => {
      let c = ciphers.get(vault.id);
      if (!c) {
        c = new VaultCipher(await this.vaults.dekFor(vault));
        ciphers.set(vault.id, c);
      }
      return c;
    };
    let initialized = 0;
    let delivered = 0;

    for (const { r, m, b, vault } of due) {
      if (r.initialized && (r.nextDueOn === null || r.nextDueOn > today)) continue;
      const where = and(
        eq(scheduledMessageRecipients.messageId, r.messageId),
        eq(scheduledMessageRecipients.beneficiaryId, r.beneficiaryId),
        eq(scheduledMessageRecipients.status, "pending"),
        eq(scheduledMessageRecipients.initialized, r.initialized),
      );
      if (b.status === "declined") {
        await this.ctx.db.update(scheduledMessageRecipients).set({ status: "stopped", updatedAt: this.ctx.now() }).where(where);
        continue;
      }
      const cipher = await cipherFor(vault);
      const sctx = await this.scheduleContext(vault, cipher, b);
      if (!sctx) continue;
      const trigger = this.decryptTrigger(m, cipher);

      if (!r.initialized) {
        const next = nextOccurrence(trigger, sctx, sctx.releaseDate, true);
        await this.ctx.db
          .update(scheduledMessageRecipients)
          .set({ initialized: true, nextDueOn: next, status: next === null && trigger.kind !== "life_event" ? "done" : "pending", updatedAt: this.ctx.now() })
          .where(where);
        initialized++;
        if (next === null || next > today) continue;
        r.nextDueOn = next;
      }

      const occurrence = r.nextDueOn as string;
      // If the worker was down for a while, don't replay every missed year: resume from today.
      const from = isoFromFixed(Math.max(fixedFromIso(occurrence) + 1, fixedFromIso(today)));
      const next = nextOccurrence(trigger, sctx, from, false);
      const held = b.messagesPausedAt !== null;
      const inserted = await this.ctx.db.transaction(async (tx) => {
        const advanced = await tx
          .update(scheduledMessageRecipients)
          .set({ nextDueOn: next, status: next === null ? "done" : "pending", updatedAt: this.ctx.now() })
          .where(
            and(
              eq(scheduledMessageRecipients.messageId, r.messageId),
              eq(scheduledMessageRecipients.beneficiaryId, r.beneficiaryId),
              eq(scheduledMessageRecipients.status, "pending"),
              lte(scheduledMessageRecipients.nextDueOn, today),
              eq(scheduledMessageRecipients.nextDueOn, occurrence),
            ),
          )
          .returning({ id: scheduledMessageRecipients.messageId });
        if (advanced.length === 0) return false; // handled concurrently
        const rows = await tx
          .insert(messageDeliveries)
          .values({ messageId: m.id, beneficiaryId: b.id, occurrenceOn: occurrence, held })
          .onConflictDoNothing()
          .returning({ id: messageDeliveries.id });
        return rows.length > 0;
      });
      if (!inserted) continue;
      delivered++;
      if (!held) await this.notify(vault, cipher, b);
    }
    return { initialized, delivered };
  }

  private async notify(vault: VaultRow, cipher: VaultCipher, b: BeneficiaryRow): Promise<void> {
    const [legator] = await this.ctx.db
      .select({ displayName: users.displayName, locale: users.locale })
      .from(users)
      .where(eq(users.id, vault.legatorUserId));
    const [recipientUser] = b.userId ? await this.ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, b.userId)) : [];
    const locale = isLocale(recipientUser?.locale) ? recipientUser.locale : isLocale(legator?.locale) ? legator.locale : DEFAULT_LOCALE;
    const email = cipher.decrypt(b.emailEnc, aad.email(b.id));
    const link = new URL(`/${locale}/app/inheritances/${vault.id}`, this.ctx.env.WEB_ORIGIN).toString();
    try {
      await this.ctx.mailer.send(messageEmails.messageArrived(email, locale, legator?.displayName ?? "", link));
    } catch (err) {
      // The delivery is recorded; the recipient will see it on their next visit.
      this.ctx.log.warn({ err: (err as Error).message }, "message notification email failed");
    }
  }
}
