import { and, eq, ne } from "drizzle-orm";
import type { AppContext } from "../../context.js";
import type { DbExecutor } from "../../db/client.js";
import { sessions, users } from "../../db/schema.js";
import { generateToken, sha256 } from "../../lib/crypto/tokens.js";

export interface SessionMeta {
  ipHash: string | null;
  userAgent: string | null;
}

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  reauthAt: Date;
  expiresAt: Date;
  user: {
    id: string;
    email: string;
    displayName: string;
    locale: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
  };
}

/** Only refresh last_seen_at at most once a minute to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60_000;

export class SessionService {
  constructor(private readonly ctx: AppContext) {}

  async create(userId: string, meta: SessionMeta, db: DbExecutor = this.ctx.db): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const now = this.ctx.now();
    const expiresAt = new Date(now.getTime() + this.ctx.env.SESSION_ABSOLUTE_TIMEOUT_DAYS * 86_400_000);
    await db.insert(sessions).values({
      userId,
      tokenHash: sha256(token),
      createdAt: now,
      lastSeenAt: now,
      reauthAt: now,
      expiresAt,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
    });
    return { token, expiresAt };
  }

  async validate(token: string): Promise<AuthenticatedSession | null> {
    if (token.length < 20 || token.length > 200) return null;
    const rows = await this.ctx.db
      .select({
        session: sessions,
        user: {
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          locale: users.locale,
          emailVerifiedAt: users.emailVerifiedAt,
          mfaEnabledAt: users.mfaEnabledAt,
        },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, sha256(token)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const now = this.ctx.now();
    const idleDeadline = row.session.lastSeenAt.getTime() + this.ctx.env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
    if (row.session.expiresAt <= now || idleDeadline <= now.getTime()) {
      await this.ctx.db.delete(sessions).where(eq(sessions.id, row.session.id));
      return null;
    }
    if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.ctx.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
    }
    return {
      sessionId: row.session.id,
      userId: row.user.id,
      reauthAt: row.session.reauthAt,
      expiresAt: row.session.expiresAt,
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        locale: row.user.locale,
        emailVerified: row.user.emailVerifiedAt !== null,
        mfaEnabled: row.user.mfaEnabledAt !== null,
      },
    };
  }

  async markReauthenticated(sessionId: string): Promise<void> {
    await this.ctx.db.update(sessions).set({ reauthAt: this.ctx.now() }).where(eq(sessions.id, sessionId));
  }

  isRecentlyReauthenticated(session: AuthenticatedSession): boolean {
    return this.ctx.now().getTime() - session.reauthAt.getTime() <= this.ctx.env.REAUTH_WINDOW_MINUTES * 60_000;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.ctx.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  async revokeAll(userId: string, db: DbExecutor = this.ctx.db): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async revokeAllExcept(userId: string, keepSessionId: string, db: DbExecutor = this.ctx.db): Promise<void> {
    await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
  }
}
