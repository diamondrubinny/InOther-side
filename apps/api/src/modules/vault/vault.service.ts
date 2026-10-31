import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  CURRENT_TERMS_VERSION,
  QUESTION_TOPICS,
  TOTAL_QUESTIONS,
  findQuestion,
  type AnswerInput,
  type BeneficiaryInput,
  type ExecutorInput,
  type StoryInput,
  type UpdateVaultInput,
} from "@inother/shared";
import type { AppContext } from "../../context.js";
import type { DbExecutor } from "../../db/client.js";
import {
  consents,
  guidedAnswers,
  legacyVaults,
  sealedStories,
  storyAudienceMembers,
  vaultBeneficiaries,
  vaultExecutors,
} from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { generateDek, VaultCipher } from "../../lib/crypto/keys.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";

export const LIMITS = { beneficiaries: 50, executors: 5, stories: 500 } as const;

type VaultRow = typeof legacyVaults.$inferSelect;

export interface OwnedVault {
  vault: VaultRow;
  cipher: VaultCipher;
}

/** AAD binds each ciphertext to its table, column and row. */
const aad = (table: string, column: string, id: string) => `${table}.${column}:${id}`;

export class VaultService {
  constructor(private readonly ctx: AppContext) {}

  private dekContext(vaultId: string): string {
    return `vault:${vaultId}`;
  }

  // ---------------------------------------------------------------------------
  // Vault
  // ---------------------------------------------------------------------------

  async create(userId: string, ipHash: string | null): Promise<VaultRow> {
    const id = randomUUID();
    const dek = generateDek();
    const wrappedDek = await this.ctx.keys.wrapKey(dek, this.dekContext(id));
    const now = this.ctx.now();
    return this.ctx.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(legacyVaults)
        .values({ id, legatorUserId: userId, wrappedDek, kekId: this.ctx.keys.kekId, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: legacyVaults.legatorUserId })
        .returning();
      const vault = inserted[0];
      if (!vault) throw conflict("vault_already_exists");
      await tx.insert(consents).values({
        userId,
        purpose: "legacy_vault_processing",
        policyVersion: CURRENT_TERMS_VERSION,
        grantedAt: now,
      });
      await writeAudit(tx, { actorId: userId, action: "vault.created", targetType: "vault", targetId: id, ipHash });
      return vault;
    });
  }

  /**
   * The only way to reach vault data: always scoped by the authenticated legator.
   * There is no vault id in URLs, so a user cannot address another user's vault.
   */
  async getOwned(userId: string): Promise<OwnedVault> {
    const [vault] = await this.ctx.db.select().from(legacyVaults).where(eq(legacyVaults.legatorUserId, userId));
    if (!vault) throw notFound("vault_not_found");
    const dek = await this.ctx.keys.unwrapKey(vault.wrappedDek, vault.kekId, this.dekContext(vault.id));
    return { vault, cipher: new VaultCipher(dek) };
  }

  /** Content can only be changed while the legator is building the vault. */
  private assertEditable(vault: VaultRow): void {
    if (vault.status === "released" || vault.status === "release_pending") throw conflict("vault_locked");
  }

  async summary(userId: string) {
    const { vault, cipher } = await this.getOwned(userId);
    const [[b], [e], [s], answered] = await Promise.all([
      this.ctx.db.select({ n: count() }).from(vaultBeneficiaries).where(eq(vaultBeneficiaries.vaultId, vault.id)),
      this.ctx.db.select({ n: count() }).from(vaultExecutors).where(eq(vaultExecutors.vaultId, vault.id)),
      this.ctx.db.select({ n: count() }).from(sealedStories).where(eq(sealedStories.vaultId, vault.id)),
      this.ctx.db.select({ questionId: guidedAnswers.questionId }).from(guidedAnswers).where(eq(guidedAnswers.vaultId, vault.id)),
    ]);
    const answeredIds = new Set(answered.map((a) => a.questionId));
    const topics = QUESTION_TOPICS.map((t) => ({
      id: t.id,
      total: t.questions.length,
      answered: t.questions.filter((q) => answeredIds.has(q.id)).length,
    }));
    const answeredCount = topics.reduce((sum, t) => sum + t.answered, 0);
    return {
      id: vault.id,
      status: vault.status,
      releaseWaitDays: vault.releaseWaitDays,
      requireSecondExecutor: vault.requireSecondExecutor,
      neverRelease: vault.status === "never_release",
      openingMessage: vault.openingMessageEnc ? cipher.decrypt(vault.openingMessageEnc, aad("vault", "opening_message", vault.id)) : null,
      counts: { beneficiaries: b?.n ?? 0, executors: e?.n ?? 0, stories: s?.n ?? 0, answers: answeredCount },
      completeness: {
        answered: answeredCount,
        totalQuestions: TOTAL_QUESTIONS,
        percent: Math.round((answeredCount / TOTAL_QUESTIONS) * 100),
        topics,
        /** Setup checklist so the UI can guide the legator. */
        checklist: {
          hasBeneficiary: (b?.n ?? 0) > 0,
          hasExecutor: (e?.n ?? 0) > 0,
          hasSecondExecutor: (e?.n ?? 0) > 1,
          hasOpeningMessage: vault.openingMessageEnc !== null,
        },
      },
      createdAt: vault.createdAt,
      updatedAt: vault.updatedAt,
    };
  }

  async update(userId: string, input: UpdateVaultInput, ipHash: string | null): Promise<void> {
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    const set: Partial<typeof legacyVaults.$inferInsert> = { updatedAt: this.ctx.now() };
    if (input.releaseWaitDays !== undefined) set.releaseWaitDays = input.releaseWaitDays;
    if (input.requireSecondExecutor !== undefined) set.requireSecondExecutor = input.requireSecondExecutor;
    if (input.neverRelease !== undefined) set.status = input.neverRelease ? "never_release" : "building";
    if (input.openingMessage !== undefined) {
      set.openingMessageEnc =
        input.openingMessage === null || input.openingMessage === ""
          ? null
          : cipher.encrypt(input.openingMessage, aad("vault", "opening_message", vault.id));
    }
    await this.ctx.db.update(legacyVaults).set(set).where(eq(legacyVaults.id, vault.id));
    await writeAudit(this.ctx.db, {
      actorId: userId,
      action: "vault.updated",
      targetType: "vault",
      targetId: vault.id,
      ipHash,
      metadata: { fields: Object.keys(input).sort().join(",") },
    });
  }

  /**
   * Permanent deletion. Rows cascade; the wrapped DEK is deleted with the vault row,
   * which makes any copies of ciphertext (e.g. in backups) unreadable (crypto-shredding).
   */
  async delete(userId: string, ipHash: string | null): Promise<void> {
    const [vault] = await this.ctx.db.select({ id: legacyVaults.id }).from(legacyVaults).where(eq(legacyVaults.legatorUserId, userId));
    if (!vault) throw notFound("vault_not_found");
    await this.ctx.db.transaction(async (tx) => {
      await tx.delete(legacyVaults).where(eq(legacyVaults.id, vault.id));
      await writeAudit(tx, { actorId: userId, action: "vault.deleted", targetType: "vault", targetId: vault.id, ipHash });
    });
  }

  // ---------------------------------------------------------------------------
  // Beneficiaries & executors (people the legator designates)
  // ---------------------------------------------------------------------------

  async listBeneficiaries(userId: string) {
    const { vault, cipher } = await this.getOwned(userId);
    const rows = await this.ctx.db
      .select()
      .from(vaultBeneficiaries)
      .where(eq(vaultBeneficiaries.vaultId, vault.id))
      .orderBy(asc(vaultBeneficiaries.createdAt));
    return rows.map((r) => this.presentBeneficiary(r, cipher));
  }

  private presentBeneficiary(r: typeof vaultBeneficiaries.$inferSelect, cipher: VaultCipher) {
    return {
      id: r.id,
      name: cipher.decrypt(r.nameEnc, aad("beneficiary", "name", r.id)),
      email: cipher.decrypt(r.emailEnc, aad("beneficiary", "email", r.id)),
      relation: r.relation,
      notifyBeforeDeath: r.notifyBeforeDeath,
      status: r.status,
      createdAt: r.createdAt,
    };
  }

  async addBeneficiary(userId: string, input: BeneficiaryInput, ipHash: string | null) {
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    await this.assertBelowLimit(vaultBeneficiaries, vaultBeneficiaries.vaultId, vault.id, LIMITS.beneficiaries);
    const id = randomUUID();
    const [row] = await this.ctx.db
      .insert(vaultBeneficiaries)
      .values({
        id,
        vaultId: vault.id,
        nameEnc: cipher.encrypt(input.name, aad("beneficiary", "name", id)),
        emailEnc: cipher.encrypt(input.email, aad("beneficiary", "email", id)),
        relation: input.relation,
        notifyBeforeDeath: input.notifyBeforeDeath,
      })
      .returning();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.beneficiary.created", targetType: "beneficiary", targetId: id, ipHash });
    return this.presentBeneficiary(row as typeof vaultBeneficiaries.$inferSelect, cipher);
  }

  async updateBeneficiary(userId: string, id: string, input: Partial<BeneficiaryInput>, ipHash: string | null) {
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    const set: Partial<typeof vaultBeneficiaries.$inferInsert> = { updatedAt: this.ctx.now() };
    if (input.name !== undefined) set.nameEnc = cipher.encrypt(input.name, aad("beneficiary", "name", id));
    if (input.email !== undefined) set.emailEnc = cipher.encrypt(input.email, aad("beneficiary", "email", id));
    if (input.relation !== undefined) set.relation = input.relation;
    if (input.notifyBeforeDeath !== undefined) set.notifyBeforeDeath = input.notifyBeforeDeath;
    const [row] = await this.ctx.db
      .update(vaultBeneficiaries)
      .set(set)
      .where(and(eq(vaultBeneficiaries.id, id), eq(vaultBeneficiaries.vaultId, vault.id)))
      .returning();
    if (!row) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.beneficiary.updated", targetType: "beneficiary", targetId: id, ipHash });
    return this.presentBeneficiary(row, cipher);
  }

  async deleteBeneficiary(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.getOwned(userId);
    this.assertEditable(vault);
    const deleted = await this.ctx.db
      .delete(vaultBeneficiaries)
      .where(and(eq(vaultBeneficiaries.id, id), eq(vaultBeneficiaries.vaultId, vault.id)))
      .returning({ id: vaultBeneficiaries.id });
    if (deleted.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.beneficiary.deleted", targetType: "beneficiary", targetId: id, ipHash });
  }

  async listExecutors(userId: string) {
    const { vault, cipher } = await this.getOwned(userId);
    const rows = await this.ctx.db
      .select()
      .from(vaultExecutors)
      .where(eq(vaultExecutors.vaultId, vault.id))
      .orderBy(asc(vaultExecutors.createdAt));
    return rows.map((r) => this.presentExecutor(r, cipher));
  }

  private presentExecutor(r: typeof vaultExecutors.$inferSelect, cipher: VaultCipher) {
    return {
      id: r.id,
      name: cipher.decrypt(r.nameEnc, aad("executor", "name", r.id)),
      email: cipher.decrypt(r.emailEnc, aad("executor", "email", r.id)),
      relation: r.relation,
      status: r.status,
      createdAt: r.createdAt,
    };
  }

  async addExecutor(userId: string, input: ExecutorInput, ipHash: string | null) {
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    await this.assertBelowLimit(vaultExecutors, vaultExecutors.vaultId, vault.id, LIMITS.executors);
    const id = randomUUID();
    const [row] = await this.ctx.db
      .insert(vaultExecutors)
      .values({
        id,
        vaultId: vault.id,
        nameEnc: cipher.encrypt(input.name, aad("executor", "name", id)),
        emailEnc: cipher.encrypt(input.email, aad("executor", "email", id)),
        relation: input.relation,
      })
      .returning();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.executor.created", targetType: "executor", targetId: id, ipHash });
    return this.presentExecutor(row as typeof vaultExecutors.$inferSelect, cipher);
  }

  async updateExecutor(userId: string, id: string, input: Partial<ExecutorInput>, ipHash: string | null) {
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    const set: Partial<typeof vaultExecutors.$inferInsert> = { updatedAt: this.ctx.now() };
    if (input.name !== undefined) set.nameEnc = cipher.encrypt(input.name, aad("executor", "name", id));
    if (input.email !== undefined) set.emailEnc = cipher.encrypt(input.email, aad("executor", "email", id));
    if (input.relation !== undefined) set.relation = input.relation;
    const [row] = await this.ctx.db
      .update(vaultExecutors)
      .set(set)
      .where(and(eq(vaultExecutors.id, id), eq(vaultExecutors.vaultId, vault.id)))
      .returning();
    if (!row) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.executor.updated", targetType: "executor", targetId: id, ipHash });
    return this.presentExecutor(row, cipher);
  }

  async deleteExecutor(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.getOwned(userId);
    this.assertEditable(vault);
    const deleted = await this.ctx.db
      .delete(vaultExecutors)
      .where(and(eq(vaultExecutors.id, id), eq(vaultExecutors.vaultId, vault.id)))
      .returning({ id: vaultExecutors.id });
    if (deleted.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.executor.deleted", targetType: "executor", targetId: id, ipHash });
  }

  // ---------------------------------------------------------------------------
  // Sealed stories
  // ---------------------------------------------------------------------------

  async listStories(userId: string) {
    const { vault, cipher } = await this.getOwned(userId);
    const rows = await this.ctx.db
      .select()
      .from(sealedStories)
      .where(eq(sealedStories.vaultId, vault.id))
      .orderBy(asc(sealedStories.createdAt));
    const audience = await this.audienceFor(rows.map((r) => r.id));
    // List view: metadata + title only (bodies can be long; fetched individually).
    return rows.map((r) => ({ ...this.presentStoryMeta(r, cipher), beneficiaryIds: audience.get(r.id) ?? [] }));
  }

  async getStory(userId: string, id: string) {
    const { vault, cipher } = await this.getOwned(userId);
    const [row] = await this.ctx.db
      .select()
      .from(sealedStories)
      .where(and(eq(sealedStories.id, id), eq(sealedStories.vaultId, vault.id)));
    if (!row) throw notFound();
    const audience = await this.audienceFor([row.id]);
    return {
      ...this.presentStoryMeta(row, cipher),
      body: cipher.decrypt(row.bodyEnc, aad("story", "body", row.id)),
      beneficiaryIds: audience.get(row.id) ?? [],
    };
  }

  private presentStoryMeta(r: typeof sealedStories.$inferSelect, cipher: VaultCipher) {
    return {
      id: r.id,
      title: cipher.decrypt(r.titleEnc, aad("story", "title", r.id)),
      audience: r.audience,
      releaseRule: r.releaseRule,
      releaseAt: r.releaseAt,
      topic: r.topicEnc ? cipher.decrypt(r.topicEnc, aad("story", "topic", r.id)) : null,
      delivery: r.delivery,
      sensitivityAck: r.sensitivityAck,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private async audienceFor(storyIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (storyIds.length === 0) return map;
    const rows = await this.ctx.db
      .select()
      .from(storyAudienceMembers)
      .where(inArray(storyAudienceMembers.storyId, storyIds));
    for (const r of rows) map.set(r.storyId, [...(map.get(r.storyId) ?? []), r.beneficiaryId]);
    return map;
  }

  /** Every referenced beneficiary must belong to this vault (blocks cross-vault references). */
  private async assertBeneficiariesInVault(db: DbExecutor, vaultId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const found = await db
      .select({ id: vaultBeneficiaries.id })
      .from(vaultBeneficiaries)
      .where(and(eq(vaultBeneficiaries.vaultId, vaultId), inArray(vaultBeneficiaries.id, unique)));
    if (found.length !== unique.length) throw badRequest("unknown_beneficiary");
  }

  private storyColumns(id: string, input: StoryInput, cipher: VaultCipher) {
    return {
      titleEnc: cipher.encrypt(input.title, aad("story", "title", id)),
      bodyEnc: cipher.encrypt(input.body, aad("story", "body", id)),
      audience: input.audience,
      releaseRule: input.releaseRule,
      releaseAt: input.releaseRule === "date" ? input.releaseAt : null,
      topicEnc: input.releaseRule === "on_topic" && input.topic ? cipher.encrypt(input.topic, aad("story", "topic", id)) : null,
      delivery: input.delivery,
      sensitivityAck: input.sensitivityAck,
    };
  }

  async createStory(userId: string, input: StoryInput, ipHash: string | null) {
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    await this.assertBelowLimit(sealedStories, sealedStories.vaultId, vault.id, LIMITS.stories);
    const id = randomUUID();
    await this.ctx.db.transaction(async (tx) => {
      await this.assertBeneficiariesInVault(tx, vault.id, input.beneficiaryIds);
      await tx.insert(sealedStories).values({ id, vaultId: vault.id, ...this.storyColumns(id, input, cipher) });
      if (input.audience === "specific") {
        await tx.insert(storyAudienceMembers).values([...new Set(input.beneficiaryIds)].map((beneficiaryId) => ({ storyId: id, beneficiaryId })));
      }
      await writeAudit(tx, { actorId: userId, action: "vault.story.created", targetType: "story", targetId: id, ipHash });
    });
    return this.getStory(userId, id);
  }

  async updateStory(userId: string, id: string, input: StoryInput, ipHash: string | null) {
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    await this.ctx.db.transaction(async (tx) => {
      const updated = await tx
        .update(sealedStories)
        .set({ ...this.storyColumns(id, input, cipher), updatedAt: this.ctx.now() })
        .where(and(eq(sealedStories.id, id), eq(sealedStories.vaultId, vault.id)))
        .returning({ id: sealedStories.id });
      if (updated.length === 0) throw notFound();
      await this.assertBeneficiariesInVault(tx, vault.id, input.beneficiaryIds);
      await tx.delete(storyAudienceMembers).where(eq(storyAudienceMembers.storyId, id));
      if (input.audience === "specific") {
        await tx.insert(storyAudienceMembers).values([...new Set(input.beneficiaryIds)].map((beneficiaryId) => ({ storyId: id, beneficiaryId })));
      }
      await writeAudit(tx, { actorId: userId, action: "vault.story.updated", targetType: "story", targetId: id, ipHash });
    });
    return this.getStory(userId, id);
  }

  async deleteStory(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.getOwned(userId);
    this.assertEditable(vault);
    const deleted = await this.ctx.db
      .delete(sealedStories)
      .where(and(eq(sealedStories.id, id), eq(sealedStories.vaultId, vault.id)))
      .returning({ id: sealedStories.id });
    if (deleted.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.story.deleted", targetType: "story", targetId: id, ipHash });
  }

  // ---------------------------------------------------------------------------
  // Guided answers
  // ---------------------------------------------------------------------------

  async listAnswers(userId: string) {
    const { vault, cipher } = await this.getOwned(userId);
    const rows = await this.ctx.db.select().from(guidedAnswers).where(eq(guidedAnswers.vaultId, vault.id));
    return rows.map((r) => ({
      questionId: r.questionId,
      text: cipher.decrypt(r.textEnc, aad("answer", "text", r.id)),
      updatedAt: r.updatedAt,
    }));
  }

  async saveAnswer(userId: string, input: AnswerInput, ipHash: string | null) {
    if (!findQuestion(input.questionId)) throw badRequest("unknown_question");
    const { vault, cipher } = await this.getOwned(userId);
    this.assertEditable(vault);
    const [existing] = await this.ctx.db
      .select({ id: guidedAnswers.id })
      .from(guidedAnswers)
      .where(and(eq(guidedAnswers.vaultId, vault.id), eq(guidedAnswers.questionId, input.questionId)));
    const id = existing?.id ?? randomUUID();
    const textEnc = cipher.encrypt(input.text, aad("answer", "text", id));
    const now = this.ctx.now();
    await this.ctx.db
      .insert(guidedAnswers)
      .values({ id, vaultId: vault.id, questionId: input.questionId, textEnc, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [guidedAnswers.vaultId, guidedAnswers.questionId], set: { textEnc, updatedAt: now } });
    await writeAudit(this.ctx.db, {
      actorId: userId,
      action: "vault.answer.saved",
      targetType: "answer",
      targetId: id,
      ipHash,
      metadata: { questionId: input.questionId },
    });
    return { questionId: input.questionId, text: input.text, updatedAt: now };
  }

  async deleteAnswer(userId: string, questionId: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.getOwned(userId);
    this.assertEditable(vault);
    const deleted = await this.ctx.db
      .delete(guidedAnswers)
      .where(and(eq(guidedAnswers.vaultId, vault.id), eq(guidedAnswers.questionId, questionId)))
      .returning({ id: guidedAnswers.id });
    if (deleted.length === 0) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.answer.deleted", targetType: "answer", targetId: deleted[0]?.id, ipHash, metadata: { questionId } });
  }

  // ---------------------------------------------------------------------------
  // Export (portable, open format — the legator's data must outlive any vendor)
  // ---------------------------------------------------------------------------

  async export(userId: string, ipHash: string | null) {
    const summary = await this.summary(userId);
    const [beneficiaries, executors, answers, storyList] = await Promise.all([
      this.listBeneficiaries(userId),
      this.listExecutors(userId),
      this.listAnswers(userId),
      this.listStories(userId),
    ]);
    const stories = await Promise.all(storyList.map((s) => this.getStory(userId, s.id)));
    await writeAudit(this.ctx.db, { actorId: userId, action: "vault.exported", targetType: "vault", targetId: summary.id, ipHash });
    return {
      format: "inother-legacy-export",
      formatVersion: 1,
      exportedAt: this.ctx.now().toISOString(),
      vault: summary,
      beneficiaries,
      executors,
      answers: answers.map((a) => ({ ...a, question: findQuestion(a.questionId)?.he ?? null })),
      stories,
    };
  }

  private async assertBelowLimit(
    table: typeof vaultBeneficiaries | typeof vaultExecutors | typeof sealedStories,
    column: typeof vaultBeneficiaries.vaultId | typeof vaultExecutors.vaultId | typeof sealedStories.vaultId,
    vaultId: string,
    limit: number,
  ): Promise<void> {
    const [row] = await this.ctx.db.select({ n: count() }).from(table).where(eq(column, vaultId));
    if ((row?.n ?? 0) >= limit) throw conflict("limit_reached");
  }
}
