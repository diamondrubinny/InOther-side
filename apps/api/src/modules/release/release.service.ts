import { Readable } from "node:stream";
import { and, eq, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import {
  DEFAULT_LOCALE,
  RELEASE_DOCUMENT_MAX_BYTES,
  RELEASE_DOCUMENT_TYPES,
  isLocale,
  type Locale,
} from "@inother/shared";
import type { AppContext } from "../../context.js";
import type { DbExecutor } from "../../db/client.js";
import {
  invitations,
  legacyVaults,
  releaseRequests,
  users,
  vaultBeneficiaries,
  vaultExecutors,
} from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { VaultCipher } from "../../lib/crypto/keys.js";
import { createDecryptStream, createEncryptStream } from "../../lib/crypto/stream.js";
import { generateToken, sha256 } from "../../lib/crypto/tokens.js";
import { AppError, badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../../lib/errors.js";
import { detectType } from "../../lib/file-inspection.js";
import { readAll } from "../media/media.service.js";
import { ByteLimit } from "../media/media.service.js";
import type { VaultService } from "../vault/vault.service.js";
import { releaseEmails } from "./emails.js";

type VaultRow = typeof legacyVaults.$inferSelect;
type ReleaseRow = typeof releaseRequests.$inferSelect;

export const OPEN_STATUSES = ["awaiting_document", "pending_review", "awaiting_second_confirmation", "waiting_period"] as const;
const INVITE_TTL_DAYS = { executor: 30, beneficiary: 90 } as const;
const DOCUMENT_EXT = new Set(["pdf", "jpg", "png"]);

const aad = (table: string, column: string, id: string) => `${table}.${column}:${id}`;
const documentAad = (id: string) => `release.document:${id}`;
export const documentKey = (vaultId: string, requestId: string) => `release/${vaultId}/${requestId}`;

/**
 * Invitations for executors/beneficiaries and the release-after-death flow.
 *
 *   executor reports death  ─▶ awaiting_document ─▶ (certificate uploaded, scanned)
 *   ─▶ pending_review (staff) ─▶ [awaiting_second_confirmation] ─▶ waiting_period ─▶ released
 *
 * The legator is emailed a cancel link at report time and again on approval, and can cancel
 * at any point before release (also from inside the app). Nothing is visible to beneficiaries
 * before "released".
 */
export class ReleaseService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
  ) {}

  private link(path: string, token?: string): string {
    const url = new URL(path, this.ctx.env.WEB_ORIGIN);
    if (token) url.hash = `token=${token}`;
    return url.toString();
  }

  private async vaultById(vaultId: string): Promise<{ vault: VaultRow; cipher: VaultCipher }> {
    const [vault] = await this.ctx.db.select().from(legacyVaults).where(eq(legacyVaults.id, vaultId));
    if (!vault) throw notFound();
    return { vault, cipher: new VaultCipher(await this.vaults.dekFor(vault)) };
  }

  private async legatorOf(vault: VaultRow): Promise<{ email: string; displayName: string; locale: Locale }> {
    const [u] = await this.ctx.db
      .select({ email: users.email, displayName: users.displayName, locale: users.locale })
      .from(users)
      .where(eq(users.id, vault.legatorUserId));
    if (!u) throw notFound();
    return { email: u.email, displayName: u.displayName, locale: isLocale(u.locale) ? u.locale : DEFAULT_LOCALE };
  }

  // ---------------------------------------------------------------------------
  // Invitations (legator side)
  // ---------------------------------------------------------------------------

  private async createInvitation(
    db: DbExecutor,
    vaultId: string,
    kind: "executor" | "beneficiary",
    personId: string,
  ): Promise<string> {
    const token = generateToken();
    const now = this.ctx.now();
    // Invalidate older unused invitations for the same person.
    await db
      .update(invitations)
      .set({ usedAt: now })
      .where(and(eq(invitations.personId, personId), isNull(invitations.usedAt)));
    await db.insert(invitations).values({
      vaultId,
      kind,
      personId,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS[kind] * 86_400_000),
      createdAt: now,
    });
    return token;
  }

  async inviteExecutor(userId: string, executorId: string, ipHash: string | null): Promise<void> {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const [ex] = await this.ctx.db
      .select()
      .from(vaultExecutors)
      .where(and(eq(vaultExecutors.id, executorId), eq(vaultExecutors.vaultId, vault.id)));
    if (!ex) throw notFound();
    if (ex.status === "confirmed") throw conflict("already_accepted");
    const legator = await this.legatorOf(vault);
    const token = await this.createInvitation(this.ctx.db, vault.id, "executor", ex.id);
    await this.ctx.db
      .update(vaultExecutors)
      .set({ status: "invited", invitedAt: this.ctx.now(), updatedAt: this.ctx.now() })
      .where(eq(vaultExecutors.id, ex.id));
    const email = cipher.decrypt(ex.emailEnc, aad("executor", "email", ex.id));
    await this.ctx.mailer.send(
      releaseEmails.executorInvite(email, legator.locale, legator.displayName, this.link("/invitation", token)),
    );
    await writeAudit(this.ctx.db, { actorId: userId, action: "invitation.sent", targetType: "executor", targetId: ex.id, ipHash });
  }

  async inviteBeneficiary(userId: string, beneficiaryId: string, ipHash: string | null): Promise<void> {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const [b] = await this.ctx.db
      .select()
      .from(vaultBeneficiaries)
      .where(and(eq(vaultBeneficiaries.id, beneficiaryId), eq(vaultBeneficiaries.vaultId, vault.id)));
    if (!b) throw notFound();
    if (b.status === "accepted") throw conflict("already_accepted");
    await this.sendBeneficiaryInvite(vault, cipher, b, "pre_release");
    await writeAudit(this.ctx.db, { actorId: userId, action: "invitation.sent", targetType: "beneficiary", targetId: b.id, ipHash });
  }

  private async sendBeneficiaryInvite(
    vault: VaultRow,
    cipher: VaultCipher,
    b: typeof vaultBeneficiaries.$inferSelect,
    phase: "pre_release" | "released",
  ): Promise<void> {
    const legator = await this.legatorOf(vault);
    const token = await this.createInvitation(this.ctx.db, vault.id, "beneficiary", b.id);
    await this.ctx.db
      .update(vaultBeneficiaries)
      .set({ status: b.status === "accepted" ? "accepted" : "invited", invitedAt: this.ctx.now(), updatedAt: this.ctx.now() })
      .where(eq(vaultBeneficiaries.id, b.id));
    const email = cipher.decrypt(b.emailEnc, aad("beneficiary", "email", b.id));
    const link = this.link("/invitation", token);
    await this.ctx.mailer.send(
      phase === "released"
        ? releaseEmails.legacyReleased(email, legator.locale, legator.displayName, link)
        : releaseEmails.beneficiaryInvite(email, legator.locale, legator.displayName, link),
    );
  }

  /**
   * Accepting links the invitee's account to the role. The signed-in account's email must
   * match the invited address, so a forwarded or leaked link is useless to anyone else.
   */
  async acceptInvitation(userId: string, userEmail: string, token: string, ipHash: string | null) {
    const [inv] = await this.ctx.db.select().from(invitations).where(eq(invitations.tokenHash, sha256(token)));
    if (!inv || inv.usedAt || inv.expiresAt <= this.ctx.now()) throw badRequest("invalid_or_expired_token");
    const { vault, cipher } = await this.vaultById(inv.vaultId);
    if (vault.legatorUserId === userId) throw forbidden("cannot_accept_own_invitation");

    const table = inv.kind === "executor" ? vaultExecutors : vaultBeneficiaries;
    const [person] = await this.ctx.db
      .select()
      .from(table)
      .where(and(eq(table.id, inv.personId), eq(table.vaultId, vault.id)));
    if (!person) throw badRequest("invalid_or_expired_token");
    const invitedEmail = cipher.decrypt(person.emailEnc, aad(inv.kind, "email", person.id));
    if (invitedEmail !== userEmail) throw forbidden("invitation_email_mismatch");

    const now = this.ctx.now();
    await this.ctx.db.transaction(async (tx) => {
      const used = await tx
        .update(invitations)
        .set({ usedAt: now })
        .where(and(eq(invitations.id, inv.id), isNull(invitations.usedAt)))
        .returning({ id: invitations.id });
      if (used.length === 0) throw badRequest("invalid_or_expired_token");
      if (inv.kind === "executor") {
        await tx
          .update(vaultExecutors)
          .set({ userId, status: "confirmed", acceptedAt: now, updatedAt: now })
          .where(eq(vaultExecutors.id, person.id));
      } else {
        await tx
          .update(vaultBeneficiaries)
          .set({ userId, status: "accepted", acceptedAt: now, updatedAt: now })
          .where(eq(vaultBeneficiaries.id, person.id));
      }
      await writeAudit(tx, { actorId: userId, action: "invitation.accepted", targetType: inv.kind, targetId: person.id, ipHash });
    });
    const legator = await this.legatorOf(vault);
    return { kind: inv.kind, legatorName: legator.displayName, vaultReleased: vault.status === "released" };
  }

  // ---------------------------------------------------------------------------
  // Executor side
  // ---------------------------------------------------------------------------

  /** Vaults where the user is a confirmed executor. No vault content is exposed here. */
  async executorRoles(userId: string) {
    const rows = await this.ctx.db
      .select({ executorId: vaultExecutors.id, vaultId: legacyVaults.id, vaultStatus: legacyVaults.status, legatorName: users.displayName })
      .from(vaultExecutors)
      .innerJoin(legacyVaults, eq(legacyVaults.id, vaultExecutors.vaultId))
      .innerJoin(users, eq(users.id, legacyVaults.legatorUserId))
      .where(and(eq(vaultExecutors.userId, userId), eq(vaultExecutors.status, "confirmed")));
    const open = rows.length
      ? await this.ctx.db
          .select()
          .from(releaseRequests)
          .where(and(inArray(releaseRequests.vaultId, rows.map((r) => r.vaultId)), inArray(releaseRequests.status, [...OPEN_STATUSES])))
      : [];
    return rows.map((r) => {
      const req = open.find((o) => o.vaultId === r.vaultId);
      return {
        vaultId: r.vaultId,
        legatorName: r.legatorName,
        released: r.vaultStatus === "released",
        openReport: req
          ? {
              id: req.id,
              status: req.status,
              reportedByMe: req.reportedByExecutorId === r.executorId,
              canConfirm: req.status === "awaiting_second_confirmation" && req.reportedByExecutorId !== r.executorId,
              waitUntil: req.waitUntil,
            }
          : null,
      };
    });
  }

  private async requireExecutor(userId: string, vaultId: string) {
    const [ex] = await this.ctx.db
      .select()
      .from(vaultExecutors)
      .where(and(eq(vaultExecutors.vaultId, vaultId), eq(vaultExecutors.userId, userId), eq(vaultExecutors.status, "confirmed")));
    if (!ex) throw notFound(); // not an executor of this vault: indistinguishable from "no such vault"
    return ex;
  }

  async reportDeath(userId: string, vaultId: string, dateOfDeath: string, ipHash: string | null) {
    const ex = await this.requireExecutor(userId, vaultId);
    const { vault } = await this.vaultById(vaultId);
    if (vault.status === "never_release") throw conflict("vault_never_release");
    if (vault.status !== "building") throw conflict("report_already_open");
    const today = this.ctx.now().toISOString().slice(0, 10);
    if (dateOfDeath > today || dateOfDeath < "1900-01-01") throw badRequest("invalid_date_of_death");

    const cancelToken = generateToken();
    let request: ReleaseRow | undefined;
    try {
      [request] = await this.ctx.db
        .insert(releaseRequests)
        .values({ vaultId, reportedByExecutorId: ex.id, dateOfDeath, cancelTokenHash: sha256(cancelToken) })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("report_already_open"); // one open request per vault
      throw err;
    }
    if (!request) throw new AppError(500, "internal_error");
    await writeAudit(this.ctx.db, { actorId: userId, action: "release.reported", targetType: "release", targetId: request.id, ipHash });

    // Tell the legator right away: the strongest protection against a false or malicious report.
    const legator = await this.legatorOf(vault);
    await this.ctx.mailer.send(
      releaseEmails.deathReported(legator.email, legator.locale, this.link("/release/cancel", cancelToken), vault.releaseWaitDays),
    );
    return { id: request.id, status: request.status };
  }

  /** Death certificate: validated, scanned and encrypted before staff can review it. */
  async uploadDocument(
    userId: string,
    requestId: string,
    body: Readable,
    contentType: string | undefined,
    contentLength: number | undefined,
    ipHash: string | null,
  ) {
    const [req] = await this.ctx.db.select().from(releaseRequests).where(eq(releaseRequests.id, requestId));
    if (!req) throw notFound();
    await this.requireExecutor(userId, req.vaultId);
    if (req.status !== "awaiting_document") throw conflict("document_not_expected");
    const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!(RELEASE_DOCUMENT_TYPES as readonly string[]).includes(mime)) throw new AppError(415, "content_type_not_allowed");
    if (contentLength === undefined || contentLength > RELEASE_DOCUMENT_MAX_BYTES) throw new AppError(413, "file_too_large");

    const limiter = new ByteLimit(RELEASE_DOCUMENT_MAX_BYTES);
    body.on("error", (e) => limiter.destroy(e));
    const data = await readAll(body.pipe(limiter));
    const detected = await detectType(data.subarray(0, 4100));
    if (!detected || !DOCUMENT_EXT.has(detected.ext)) throw badRequest("file_type_not_allowed");

    let scan;
    try {
      scan = await this.ctx.scanner.scan(Readable.from([data]));
    } catch {
      throw new AppError(503, "scan_unavailable"); // fail closed
    }
    if (!scan.clean) {
      await writeAudit(this.ctx.db, { actorId: userId, action: "release.document_infected", targetType: "release", targetId: req.id, ipHash });
      throw badRequest("file_rejected");
    }

    const { vault } = await this.vaultById(req.vaultId);
    const dek = await this.vaults.dekFor(vault);
    await this.ctx.storage.put(documentKey(vault.id, req.id), Readable.from([data]).pipe(createEncryptStream(dek, documentAad(req.id))));
    await this.ctx.db
      .update(releaseRequests)
      .set({ status: "pending_review", documentMime: detected.mime, documentSize: data.length, updatedAt: this.ctx.now() })
      .where(eq(releaseRequests.id, req.id));
    await writeAudit(this.ctx.db, { actorId: userId, action: "release.document_uploaded", targetType: "release", targetId: req.id, ipHash });
    this.ctx.log.info({ releaseId: req.id }, "death certificate awaiting staff review");
    return { id: req.id, status: "pending_review" as const };
  }

  /** A second (different) executor confirms, when the legator required it. */
  async confirmAsSecondExecutor(userId: string, requestId: string, ipHash: string | null) {
    const [req] = await this.ctx.db.select().from(releaseRequests).where(eq(releaseRequests.id, requestId));
    if (!req) throw notFound();
    const ex = await this.requireExecutor(userId, req.vaultId);
    if (req.status !== "awaiting_second_confirmation") throw conflict("confirmation_not_expected");
    if (req.reportedByExecutorId === ex.id) throw forbidden("second_executor_required");
    const { vault } = await this.vaultById(req.vaultId);
    await this.startWaitingPeriod(req, vault, { secondConfirmedByExecutorId: ex.id });
    await writeAudit(this.ctx.db, { actorId: userId, action: "release.second_confirmed", targetType: "release", targetId: req.id, ipHash });
  }

  private async startWaitingPeriod(req: ReleaseRow, vault: VaultRow, extra: Partial<typeof releaseRequests.$inferInsert> = {}) {
    const now = this.ctx.now();
    const waitUntil = new Date(now.getTime() + vault.releaseWaitDays * 86_400_000);
    // Fresh cancel link for the legator (we only store hashes, so the old one can't be re-sent).
    const cancelToken = generateToken();
    await this.ctx.db
      .update(releaseRequests)
      .set({ status: "waiting_period", waitUntil, cancelTokenHash: sha256(cancelToken), updatedAt: now, ...extra })
      .where(eq(releaseRequests.id, req.id));
    const legator = await this.legatorOf(vault);
    await this.ctx.mailer.send(
      releaseEmails.deathReported(legator.email, legator.locale, this.link("/release/cancel", cancelToken), vault.releaseWaitDays),
    );
  }

  // ---------------------------------------------------------------------------
  // Staff review
  // ---------------------------------------------------------------------------

  async pendingReviews() {
    return this.ctx.db
      .select({
        id: releaseRequests.id,
        vaultId: releaseRequests.vaultId,
        dateOfDeath: releaseRequests.dateOfDeath,
        documentMime: releaseRequests.documentMime,
        createdAt: releaseRequests.createdAt,
        legatorName: users.displayName,
      })
      .from(releaseRequests)
      .innerJoin(legacyVaults, eq(legacyVaults.id, releaseRequests.vaultId))
      .innerJoin(users, eq(users.id, legacyVaults.legatorUserId))
      .where(eq(releaseRequests.status, "pending_review"));
  }

  async reviewDocument(staffId: string, requestId: string, ipHash: string | null) {
    const [req] = await this.ctx.db.select().from(releaseRequests).where(eq(releaseRequests.id, requestId));
    if (!req || req.status !== "pending_review") throw notFound();
    const { vault } = await this.vaultById(req.vaultId);
    const dek = await this.vaults.dekFor(vault);
    const src = await this.ctx.storage.get(documentKey(vault.id, req.id));
    const dec = createDecryptStream(dek, documentAad(req.id));
    src.on("error", (e) => dec.destroy(e));
    await writeAudit(this.ctx.db, { actorId: staffId, action: "release.document_viewed", targetType: "release", targetId: req.id, ipHash });
    return { stream: src.pipe(dec), mime: req.documentMime ?? "application/octet-stream", size: req.documentSize ?? 0 };
  }

  async approve(staffId: string, requestId: string, ipHash: string | null) {
    const [req] = await this.ctx.db.select().from(releaseRequests).where(eq(releaseRequests.id, requestId));
    if (!req || req.status !== "pending_review") throw notFound();
    const { vault } = await this.vaultById(req.vaultId);
    const now = this.ctx.now();
    // A second confirmation is required only if another confirmed executor exists to give it.
    const others = await this.ctx.db
      .select({ id: vaultExecutors.id })
      .from(vaultExecutors)
      .where(
        and(
          eq(vaultExecutors.vaultId, vault.id),
          eq(vaultExecutors.status, "confirmed"),
          req.reportedByExecutorId ? ne(vaultExecutors.id, req.reportedByExecutorId) : undefined,
        ),
      );
    await this.ctx.db.update(legacyVaults).set({ status: "release_pending", updatedAt: now }).where(eq(legacyVaults.id, vault.id));
    const base = { reviewedByUserId: staffId, reviewedAt: now };
    if (vault.requireSecondExecutor && others.length > 0) {
      await this.ctx.db
        .update(releaseRequests)
        .set({ ...base, status: "awaiting_second_confirmation", updatedAt: now })
        .where(eq(releaseRequests.id, req.id));
    } else {
      await this.startWaitingPeriod(req, vault, base);
    }
    await writeAudit(this.ctx.db, { actorId: staffId, action: "release.approved", targetType: "release", targetId: req.id, ipHash });
  }

  async reject(staffId: string, requestId: string, reason: string, ipHash: string | null) {
    const [req] = await this.ctx.db.select().from(releaseRequests).where(eq(releaseRequests.id, requestId));
    if (!req || req.status !== "pending_review") throw notFound();
    const now = this.ctx.now();
    await this.ctx.db
      .update(releaseRequests)
      .set({ status: "rejected", reviewedByUserId: staffId, reviewedAt: now, reviewReason: reason, updatedAt: now })
      .where(eq(releaseRequests.id, req.id));
    await this.ctx.storage.delete(documentKey(req.vaultId, req.id));
    await writeAudit(this.ctx.db, { actorId: staffId, action: "release.rejected", targetType: "release", targetId: req.id, ipHash, metadata: { reason } });
  }

  // ---------------------------------------------------------------------------
  // Legator cancellation
  // ---------------------------------------------------------------------------

  async legatorStatus(userId: string) {
    const { vault } = await this.vaults.getOwned(userId);
    const [req] = await this.ctx.db
      .select({ id: releaseRequests.id, status: releaseRequests.status, waitUntil: releaseRequests.waitUntil, createdAt: releaseRequests.createdAt })
      .from(releaseRequests)
      .where(and(eq(releaseRequests.vaultId, vault.id), inArray(releaseRequests.status, [...OPEN_STATUSES])));
    return { openReport: req ?? null };
  }

  async cancelByLegator(userId: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.vaults.getOwned(userId);
    const [req] = await this.ctx.db
      .select()
      .from(releaseRequests)
      .where(and(eq(releaseRequests.vaultId, vault.id), inArray(releaseRequests.status, [...OPEN_STATUSES])));
    if (!req) throw notFound();
    await this.cancel(req, vault, userId, ipHash);
  }

  /** From the emailed link: works without signing in (the legator may have lost access). */
  async cancelByToken(token: string, ipHash: string | null): Promise<void> {
    const [req] = await this.ctx.db.select().from(releaseRequests).where(eq(releaseRequests.cancelTokenHash, sha256(token)));
    if (!req || !(OPEN_STATUSES as readonly string[]).includes(req.status)) throw badRequest("invalid_or_expired_token");
    const { vault } = await this.vaultById(req.vaultId);
    await this.cancel(req, vault, vault.legatorUserId, ipHash);
  }

  private async cancel(req: ReleaseRow, vault: VaultRow, actorId: string, ipHash: string | null): Promise<void> {
    const now = this.ctx.now();
    await this.ctx.db.transaction(async (tx) => {
      await tx.update(releaseRequests).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(releaseRequests.id, req.id));
      if (vault.status === "release_pending") {
        await tx.update(legacyVaults).set({ status: "building", updatedAt: now }).where(eq(legacyVaults.id, vault.id));
      }
      await writeAudit(tx, { actorId, action: "release.cancelled", targetType: "release", targetId: req.id, ipHash });
    });
    await this.ctx.storage.delete(documentKey(vault.id, req.id));
    // A report cancelled by a living legator may indicate abuse: surface it to operations.
    this.ctx.log.warn({ releaseId: req.id, vaultId: vault.id }, "death report cancelled by legator (possible false report)");
    const { cipher } = await this.vaultById(vault.id);
    const legator = await this.legatorOf(vault);
    const executors = await this.ctx.db
      .select()
      .from(vaultExecutors)
      .where(and(eq(vaultExecutors.vaultId, vault.id), eq(vaultExecutors.status, "confirmed")));
    for (const ex of executors) {
      const email = cipher.decrypt(ex.emailEnc, aad("executor", "email", ex.id));
      await this.ctx.mailer.send(releaseEmails.reportCancelled(email, legator.locale, legator.displayName));
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduler: release vaults whose waiting period ended
  // ---------------------------------------------------------------------------

  async finalizeDue(): Promise<number> {
    const due = await this.ctx.db
      .select()
      .from(releaseRequests)
      .where(and(eq(releaseRequests.status, "waiting_period"), lte(releaseRequests.waitUntil, this.ctx.now())));
    let released = 0;
    for (const req of due) {
      const now = this.ctx.now();
      const claimed = await this.ctx.db
        .update(releaseRequests)
        .set({ status: "released", releasedAt: now, updatedAt: now })
        .where(and(eq(releaseRequests.id, req.id), eq(releaseRequests.status, "waiting_period")))
        .returning({ id: releaseRequests.id });
      if (claimed.length === 0) continue; // cancelled or handled concurrently
      await this.ctx.db.update(legacyVaults).set({ status: "released", updatedAt: now }).where(eq(legacyVaults.id, req.vaultId));
      // Data minimization: the certificate is no longer needed once the vault is released.
      await this.ctx.storage.delete(documentKey(req.vaultId, req.id));
      const { vault, cipher } = await this.vaultById(req.vaultId);
      const beneficiaries = await this.ctx.db
        .select()
        .from(vaultBeneficiaries)
        .where(and(eq(vaultBeneficiaries.vaultId, vault.id), notInArray(vaultBeneficiaries.status, ["declined"])));
      for (const b of beneficiaries) await this.sendBeneficiaryInvite(vault, cipher, b, "released");
      await writeAudit(this.ctx.db, { actorId: null, action: "release.completed", targetType: "release", targetId: req.id, metadata: { beneficiaries: beneficiaries.length } });
      released++;
    }
    return released;
  }
}
