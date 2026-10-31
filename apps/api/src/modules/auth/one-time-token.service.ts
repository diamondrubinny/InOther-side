import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppContext } from "../../context.js";
import type { DbExecutor } from "../../db/client.js";
import { oneTimeTokens } from "../../db/schema.js";
import { generateToken, sha256 } from "../../lib/crypto/tokens.js";

export type TokenPurpose = (typeof oneTimeTokens.$inferSelect)["purpose"];

const TTL_MINUTES: Record<TokenPurpose, number> = {
  email_verify: 60 * 24,
  password_reset: 30,
  mfa_challenge: 5,
};

/** Max verification attempts against one token (relevant for MFA challenges). */
export const MAX_TOKEN_ATTEMPTS = 5;

export class OneTimeTokenService {
  constructor(private readonly ctx: AppContext) {}

  /** Issues a new token and invalidates older unused tokens of the same purpose for the user. */
  async issue(userId: string, purpose: TokenPurpose, db: DbExecutor = this.ctx.db): Promise<string> {
    const now = this.ctx.now();
    await db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(and(eq(oneTimeTokens.userId, userId), eq(oneTimeTokens.purpose, purpose), isNull(oneTimeTokens.usedAt)));
    const token = generateToken();
    await db.insert(oneTimeTokens).values({
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + TTL_MINUTES[purpose] * 60_000),
      createdAt: now,
    });
    return token;
  }

  /** Finds a valid (unused, unexpired, under attempt limit) token without consuming it. */
  async peek(token: string, purpose: TokenPurpose, db: DbExecutor = this.ctx.db) {
    const rows = await db
      .select()
      .from(oneTimeTokens)
      .where(and(eq(oneTimeTokens.tokenHash, sha256(token)), eq(oneTimeTokens.purpose, purpose)))
      .limit(1);
    const row = rows[0];
    if (!row || row.usedAt || row.expiresAt <= this.ctx.now() || row.attempts >= MAX_TOKEN_ATTEMPTS) return null;
    return row;
  }

  /** Atomically marks the token used. Returns false if it was already consumed (race). */
  async consume(id: string, db: DbExecutor = this.ctx.db): Promise<boolean> {
    const updated = await db
      .update(oneTimeTokens)
      .set({ usedAt: this.ctx.now() })
      .where(and(eq(oneTimeTokens.id, id), isNull(oneTimeTokens.usedAt)))
      .returning({ id: oneTimeTokens.id });
    return updated.length === 1;
  }

  async recordFailedAttempt(id: string): Promise<void> {
    await this.ctx.db
      .update(oneTimeTokens)
      .set({ attempts: sql`${oneTimeTokens.attempts} + 1` })
      .where(eq(oneTimeTokens.id, id));
  }
}
