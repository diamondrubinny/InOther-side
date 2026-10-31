import { eq, sql } from "drizzle-orm";
import {
  CURRENT_TERMS_VERSION,
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type LoginInput,
  type LoginMfaInput,
  type RegisterInput,
} from "@inother/shared";
import type { AppContext } from "../../context.js";
import { consents, users } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, badRequest, forbidden, unauthorized } from "../../lib/errors.js";
import {
  burnPasswordVerification,
  hashPassword,
  isWeakPassword,
  needsRehash,
  verifyPassword,
} from "../../lib/password.js";
import { emails } from "./emails.js";
import { MfaService } from "./mfa.service.js";
import { OneTimeTokenService } from "./one-time-token.service.js";
import { SessionService, type SessionMeta } from "./session.service.js";

/** Lockout after this many consecutive failures; duration doubles per extra failure, capped. */
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MAX_MINUTES = 60;

const asLocale = (value: string | null | undefined): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);

export type LoginResult =
  | { kind: "session"; token: string; expiresAt: Date }
  | { kind: "mfa_required"; challengeToken: string };

export class AuthService {
  readonly sessions: SessionService;
  readonly tokens: OneTimeTokenService;
  readonly mfa: MfaService;

  constructor(private readonly ctx: AppContext) {
    this.sessions = new SessionService(ctx);
    this.tokens = new OneTimeTokenService(ctx);
    this.mfa = new MfaService(ctx);
  }

  private link(path: string, token?: string): string {
    const url = new URL(path, this.ctx.env.WEB_ORIGIN);
    // Tokens go in the fragment so they are not sent to servers or leaked via Referer.
    if (token) url.hash = `token=${token}`;
    return url.toString();
  }

  /**
   * Registration never reveals whether an email already exists: the HTTP response is identical
   * and the existing owner gets a notification email instead.
   */
  async register(input: RegisterInput, meta: SessionMeta, requestLocale: Locale): Promise<void> {
    if (isWeakPassword(input.password, { email: input.email, displayName: input.displayName })) {
      throw badRequest("password_too_weak");
    }
    const [existing] = await this.ctx.db
      .select({ id: users.id, locale: users.locale })
      .from(users)
      .where(eq(users.email, input.email));
    if (existing) {
      await burnPasswordVerification(input.password);
      await this.ctx.mailer.send(
        emails.alreadyRegistered(input.email, asLocale(existing.locale), this.link("/login"), this.link("/forgot-password")),
      );
      return;
    }
    const locale = input.locale ?? requestLocale;

    const passwordHash = await hashPassword(input.password);
    const now = this.ctx.now();
    const token = await this.ctx.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          locale,
          adultConfirmedAt: now,
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      const user = inserted[0];
      if (!user) return null; // concurrent registration with the same email
      await tx.insert(consents).values({
        userId: user.id,
        purpose: "terms_and_privacy",
        policyVersion: CURRENT_TERMS_VERSION,
        grantedAt: now,
      });
      await writeAudit(tx, { actorId: user.id, action: "auth.register", targetType: "user", targetId: user.id, ipHash: meta.ipHash });
      return this.tokens.issue(user.id, "email_verify", tx);
    });
    if (token) await this.ctx.mailer.send(emails.verifyEmail(input.email, locale, this.link("/verify-email", token)));
  }

  async resendVerification(userId: string): Promise<void> {
    const [user] = await this.ctx.db
      .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.emailVerifiedAt) return;
    const token = await this.tokens.issue(userId, "email_verify");
    await this.ctx.mailer.send(emails.verifyEmail(user.email, asLocale(user.locale), this.link("/verify-email", token)));
  }

  async verifyEmail(token: string, ipHash: string | null): Promise<void> {
    const row = await this.tokens.peek(token, "email_verify");
    if (!row || !(await this.tokens.consume(row.id))) throw badRequest("invalid_or_expired_token");
    await this.ctx.db
      .update(users)
      .set({ emailVerifiedAt: this.ctx.now(), updatedAt: this.ctx.now() })
      .where(eq(users.id, row.userId));
    await writeAudit(this.ctx.db, { actorId: row.userId, action: "auth.email_verified", targetType: "user", targetId: row.userId, ipHash });
  }

  async login(input: LoginInput, meta: SessionMeta): Promise<LoginResult> {
    const [user] = await this.ctx.db.select().from(users).where(eq(users.email, input.email));
    if (!user) {
      await burnPasswordVerification(input.password);
      throw unauthorized("invalid_credentials");
    }

    const now = this.ctx.now();
    if (user.lockedUntil && user.lockedUntil > now) {
      // Same generic response as a wrong password (no account-state disclosure).
      await burnPasswordVerification(input.password);
      await writeAudit(this.ctx.db, { actorId: user.id, action: "auth.login.locked", targetType: "user", targetId: user.id, ipHash: meta.ipHash });
      throw unauthorized("invalid_credentials");
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.registerFailedLogin(user.id, user.email, asLocale(user.locale), user.failedLoginCount + 1, meta.ipHash);
      throw unauthorized("invalid_credentials");
    }

    // Password is correct from here on.
    const updates: Partial<typeof users.$inferInsert> = { failedLoginCount: 0, lockedUntil: null };
    if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(input.password);
    await this.ctx.db.update(users).set(updates).where(eq(users.id, user.id));

    if (!user.emailVerifiedAt) {
      await this.resendVerification(user.id);
      throw forbidden("email_not_verified");
    }

    if (user.mfaEnabledAt) {
      const challengeToken = await this.tokens.issue(user.id, "mfa_challenge");
      return { kind: "mfa_required", challengeToken };
    }

    const session = await this.sessions.create(user.id, meta);
    await writeAudit(this.ctx.db, { actorId: user.id, action: "auth.login.success", targetType: "user", targetId: user.id, ipHash: meta.ipHash, metadata: { mfa: false } });
    return { kind: "session", ...session };
  }

  async completeMfaLogin(input: LoginMfaInput, meta: SessionMeta): Promise<{ token: string; expiresAt: Date }> {
    const challenge = await this.tokens.peek(input.challengeToken, "mfa_challenge");
    if (!challenge) throw unauthorized("invalid_or_expired_challenge");

    const ok = input.code
      ? await this.mfa.verifyUserCode(challenge.userId, input.code)
      : await this.mfa.consumeRecoveryCode(challenge.userId, input.recoveryCode as string, meta.ipHash);

    if (!ok) {
      await this.tokens.recordFailedAttempt(challenge.id);
      await writeAudit(this.ctx.db, { actorId: challenge.userId, action: "auth.login.failure", targetType: "user", targetId: challenge.userId, ipHash: meta.ipHash, metadata: { stage: "mfa" } });
      throw unauthorized("invalid_mfa_code");
    }
    if (!(await this.tokens.consume(challenge.id))) throw unauthorized("invalid_or_expired_challenge");

    const session = await this.sessions.create(challenge.userId, meta);
    await writeAudit(this.ctx.db, { actorId: challenge.userId, action: "auth.login.success", targetType: "user", targetId: challenge.userId, ipHash: meta.ipHash, metadata: { mfa: true } });
    return session;
  }

  private async registerFailedLogin(userId: string, email: string, locale: Locale, failures: number, ipHash: string | null): Promise<void> {
    let lockedUntil: Date | null = null;
    if (failures >= LOCKOUT_THRESHOLD) {
      const minutes = Math.min(2 ** (failures - LOCKOUT_THRESHOLD), LOCKOUT_MAX_MINUTES);
      lockedUntil = new Date(this.ctx.now().getTime() + minutes * 60_000);
    }
    await this.ctx.db
      .update(users)
      .set({ failedLoginCount: sql`${users.failedLoginCount} + 1`, lockedUntil })
      .where(eq(users.id, userId));
    await writeAudit(this.ctx.db, { actorId: userId, action: "auth.login.failure", targetType: "user", targetId: userId, ipHash, metadata: { failures } });
    if (failures === LOCKOUT_THRESHOLD) {
      await this.ctx.mailer.send(emails.securityNotice(email, locale, "account_locked"));
    }
  }

  /** Always succeeds from the caller's point of view (no account enumeration). */
  async requestPasswordReset(email: string, ipHash: string | null): Promise<void> {
    const [user] = await this.ctx.db.select({ id: users.id, locale: users.locale }).from(users).where(eq(users.email, email));
    if (!user) return;
    const token = await this.tokens.issue(user.id, "password_reset");
    await writeAudit(this.ctx.db, { actorId: user.id, action: "auth.password_reset.requested", targetType: "user", targetId: user.id, ipHash });
    await this.ctx.mailer.send(emails.passwordReset(email, asLocale(user.locale), this.link("/reset-password", token)));
  }

  async confirmPasswordReset(token: string, newPassword: string, ipHash: string | null): Promise<void> {
    const row = await this.tokens.peek(token, "password_reset");
    if (!row) throw badRequest("invalid_or_expired_token");
    const [user] = await this.ctx.db
      .select({ email: users.email, displayName: users.displayName, locale: users.locale })
      .from(users)
      .where(eq(users.id, row.userId));
    if (!user) throw badRequest("invalid_or_expired_token");
    if (isWeakPassword(newPassword, user)) throw badRequest("password_too_weak");

    const passwordHash = await hashPassword(newPassword);
    await this.ctx.db.transaction(async (tx) => {
      if (!(await this.tokens.consume(row.id, tx))) throw badRequest("invalid_or_expired_token");
      const now = this.ctx.now();
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
        .where(eq(users.id, row.userId));
      await this.sessions.revokeAll(row.userId, tx);
      await writeAudit(tx, { actorId: row.userId, action: "auth.password_reset.completed", targetType: "user", targetId: row.userId, ipHash });
    });
    await this.ctx.mailer.send(emails.securityNotice(user.email, asLocale(user.locale), "password_reset"));
  }

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
    ipHash: string | null,
  ): Promise<void> {
    const [user] = await this.ctx.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw unauthorized();
    if (!(await verifyPassword(user.passwordHash, currentPassword))) throw badRequest("invalid_current_password");
    if (isWeakPassword(newPassword, user)) throw badRequest("password_too_weak");
    const passwordHash = await hashPassword(newPassword);
    await this.ctx.db.transaction(async (tx) => {
      const now = this.ctx.now();
      await tx.update(users).set({ passwordHash, passwordChangedAt: now, updatedAt: now }).where(eq(users.id, userId));
      await this.sessions.revokeAllExcept(userId, sessionId, tx);
      await writeAudit(tx, { actorId: userId, action: "auth.password_changed", targetType: "user", targetId: userId, ipHash });
    });
    await this.ctx.mailer.send(emails.securityNotice(user.email, asLocale(user.locale), "password_changed"));
  }

  /** Step-up authentication before sensitive actions (deletion, export, MFA changes). */
  async reauthenticate(
    userId: string,
    sessionId: string,
    password: string,
    code: string | undefined,
    ipHash: string | null,
  ): Promise<void> {
    const [user] = await this.ctx.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw unauthorized();
    if (!(await verifyPassword(user.passwordHash, password))) throw unauthorized("invalid_credentials");
    if (user.mfaEnabledAt) {
      if (!code) throw new AppError(401, "mfa_code_required");
      if (!(await this.mfa.verifyUserCode(userId, code))) throw unauthorized("invalid_mfa_code");
    }
    await this.sessions.markReauthenticated(sessionId);
    await writeAudit(this.ctx.db, { actorId: userId, action: "auth.reauth", targetType: "user", targetId: userId, ipHash });
  }
}

