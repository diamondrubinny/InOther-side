import { and, eq, isNotNull, isNull, lt, notExists, or } from "drizzle-orm";
import type { AppContext } from "../../context.js";
import { captureLinks, invitations, legacyVaults, oneTimeTokens, sessions, users } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";

const DAY = 86_400_000;

/**
 * Retention policy (data minimization — GDPR art. 5(1)(e), Israeli Privacy Protection Law).
 * Keep in sync with docs/PRODUCTION-CHECKLIST.md and the privacy policy draft.
 * Vault content is NOT here: it lives until the legator deletes it (or the vault is deleted).
 * The audit log is append-only (DB trigger) and its retention is an operator task with the owner role.
 */
export const RETENTION_DAYS = {
  /** Expired / idle sessions (they can no longer be used). */
  sessions: 1,
  /** Used or expired one-time tokens (email verification, password reset, MFA challenge). */
  oneTimeTokens: 7,
  /** Used or expired invitations. */
  invitations: 30,
  /** Used, revoked or expired capture links (answers keep only a "via link" marker). */
  captureLinks: 90,
  /** Accounts that never verified their email and own no vault. */
  unverifiedAccounts: 30,
} as const;

export class RetentionService {
  constructor(private readonly ctx: AppContext) {}

  async run(): Promise<Record<keyof typeof RETENTION_DAYS, number>> {
    const now = this.ctx.now().getTime();
    const before = (days: number) => new Date(now - days * DAY);
    const idleCutoff = new Date(now - this.ctx.env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000 - RETENTION_DAYS.sessions * DAY);

    const s = await this.ctx.db
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, before(RETENTION_DAYS.sessions)), lt(sessions.lastSeenAt, idleCutoff)))
      .returning({ id: sessions.id });
    const t = await this.ctx.db
      .delete(oneTimeTokens)
      .where(
        or(
          lt(oneTimeTokens.expiresAt, before(RETENTION_DAYS.oneTimeTokens)),
          and(isNotNull(oneTimeTokens.usedAt), lt(oneTimeTokens.usedAt, before(RETENTION_DAYS.oneTimeTokens))),
        ),
      )
      .returning({ id: oneTimeTokens.id });
    const i = await this.ctx.db
      .delete(invitations)
      .where(
        or(
          lt(invitations.expiresAt, before(RETENTION_DAYS.invitations)),
          and(isNotNull(invitations.usedAt), lt(invitations.usedAt, before(RETENTION_DAYS.invitations))),
        ),
      )
      .returning({ id: invitations.id });
    const c = await this.ctx.db
      .delete(captureLinks)
      .where(
        or(
          lt(captureLinks.expiresAt, before(RETENTION_DAYS.captureLinks)),
          and(isNotNull(captureLinks.usedAt), lt(captureLinks.usedAt, before(RETENTION_DAYS.captureLinks))),
          and(isNotNull(captureLinks.revokedAt), lt(captureLinks.revokedAt, before(RETENTION_DAYS.captureLinks))),
        ),
      )
      .returning({ id: captureLinks.id });
    const u = await this.ctx.db
      .delete(users)
      .where(
        and(
          isNull(users.emailVerifiedAt),
          lt(users.createdAt, before(RETENTION_DAYS.unverifiedAccounts)),
          eq(users.role, "user"),
          notExists(this.ctx.db.select({ id: legacyVaults.id }).from(legacyVaults).where(eq(legacyVaults.legatorUserId, users.id))),
        ),
      )
      .returning({ id: users.id });

    const result = { sessions: s.length, oneTimeTokens: t.length, invitations: i.length, captureLinks: c.length, unverifiedAccounts: u.length };
    if (Object.values(result).some((n) => n > 0)) {
      await writeAudit(this.ctx.db, { actorId: null, action: "retention.purged", targetType: "system", metadata: result });
    }
    return result;
  }
}
