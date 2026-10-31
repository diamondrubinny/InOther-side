import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppContext } from "../../context.js";
import { recoveryCodes, totpUsage, users } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { badRequest, conflict } from "../../lib/errors.js";
import { generateRecoveryCode, normalizeRecoveryCode, sha256 } from "../../lib/crypto/tokens.js";
import { base32Secret, generateTotpSecret, matchTotp, totpUri } from "../../lib/totp.js";

const RECOVERY_CODE_COUNT = 10;
const ISSUER = "InOther-side";

export class MfaService {
  constructor(private readonly ctx: AppContext) {}

  private secretContext(userId: string): string {
    return `totp:${userId}`;
  }

  /** Step 1: create a pending secret. MFA is not active until confirmed with a valid code. */
  async beginSetup(userId: string, email: string): Promise<{ uri: string; secret: string }> {
    const [user] = await this.ctx.db.select({ mfaEnabledAt: users.mfaEnabledAt }).from(users).where(eq(users.id, userId));
    if (!user) throw badRequest();
    if (user.mfaEnabledAt) throw conflict("mfa_already_enabled");
    const secret = generateTotpSecret();
    const enc = await this.ctx.keys.encryptSecret(secret, this.secretContext(userId));
    await this.ctx.db.update(users).set({ totpSecretEnc: enc, updatedAt: this.ctx.now() }).where(eq(users.id, userId));
    return { uri: totpUri(ISSUER, email, secret), secret: base32Secret(secret) };
  }

  /** Step 2: confirm with a code; returns recovery codes, shown to the user exactly once. */
  async confirmSetup(userId: string, code: string, ipHash: string | null): Promise<string[]> {
    const [user] = await this.ctx.db
      .select({ totpSecretEnc: users.totpSecretEnc, mfaEnabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.totpSecretEnc) throw badRequest("mfa_setup_not_started");
    if (user.mfaEnabledAt) throw conflict("mfa_already_enabled");
    if (!(await this.verifyTotp(userId, code, user.totpSecretEnc))) throw badRequest("invalid_mfa_code");

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await this.ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ mfaEnabledAt: this.ctx.now(), updatedAt: this.ctx.now() }).where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })));
      await writeAudit(tx, { actorId: userId, action: "auth.mfa.enabled", targetType: "user", targetId: userId, ipHash });
    });
    return codes;
  }

  async disable(userId: string, code: string, ipHash: string | null): Promise<void> {
    if (!(await this.verifyUserCode(userId, code))) throw badRequest("invalid_mfa_code");
    await this.ctx.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ mfaEnabledAt: null, totpSecretEnc: null, updatedAt: this.ctx.now() })
        .where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.delete(totpUsage).where(eq(totpUsage.userId, userId));
      await writeAudit(tx, { actorId: userId, action: "auth.mfa.disabled", targetType: "user", targetId: userId, ipHash });
    });
  }

  /** Verifies a TOTP code for a user with MFA enabled (or pending setup). */
  async verifyUserCode(userId: string, code: string): Promise<boolean> {
    const [user] = await this.ctx.db.select({ totpSecretEnc: users.totpSecretEnc }).from(users).where(eq(users.id, userId));
    if (!user?.totpSecretEnc) return false;
    return this.verifyTotp(userId, code, user.totpSecretEnc);
  }

  async consumeRecoveryCode(userId: string, code: string, ipHash: string | null): Promise<boolean> {
    const hash = sha256(normalizeRecoveryCode(code));
    const used = await this.ctx.db
      .update(recoveryCodes)
      .set({ usedAt: this.ctx.now() })
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    if (used.length === 0) return false;
    await writeAudit(this.ctx.db, {
      actorId: userId,
      action: "auth.mfa.recovery_code_used",
      targetType: "user",
      targetId: userId,
      ipHash,
    });
    return true;
  }

  private async verifyTotp(userId: string, code: string, secretEnc: Buffer): Promise<boolean> {
    const secret = await this.ctx.keys.decryptSecret(secretEnc, this.secretContext(userId));
    const counter = matchTotp(secret, code, this.ctx.now().getTime());
    if (counter === null) return false;
    // Replay protection: atomically advance the last-used counter; fail if this step (or a later one) was already used.
    const result = await this.ctx.db
      .insert(totpUsage)
      .values({ userId, lastCounter: counter })
      .onConflictDoUpdate({
        target: totpUsage.userId,
        set: { lastCounter: counter },
        setWhere: sql`${totpUsage.lastCounter} < ${counter}`,
      })
      .returning({ userId: totpUsage.userId });
    return result.length === 1;
  }
}
