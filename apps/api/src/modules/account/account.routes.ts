import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { CURRENT_TERMS_VERSION, textDirection, updateProfileSchema } from "@inother/shared";
import type { AppContext } from "../../context.js";
import { consents, legacyVaults, sessions, users } from "../../db/schema.js";
import { requireAuth, requireRecentReauth, requireVerified } from "../../http/auth-guard.js";
import { writeAudit } from "../../lib/audit.js";
import { parse } from "../../lib/validate.js";
import type { SessionService } from "../auth/session.service.js";
import type { VaultService } from "../vault/vault.service.js";

/** Consents a user may grant or withdraw themselves (terms consent is withdrawn by deleting the account). */
const optionalPurposes = ["voice_cloning", "avatar_creation", "ai_processing"] as const;
const consentChangeSchema = z.object({ purpose: z.enum(optionalPurposes), granted: z.boolean() });

export function accountRoutes(ctx: AppContext, sessionService: SessionService, vaults: VaultService) {
  const isRecent = sessionService.isRecentlyReauthenticated.bind(sessionService);

  return async function (app: FastifyInstance): Promise<void> {
    app.get("/me", async (request) => {
      const auth = requireAuth(request);
      return {
        id: auth.user.id,
        email: auth.user.email,
        displayName: auth.user.displayName,
        locale: auth.user.locale,
        dir: textDirection(request.locale),
        emailVerified: auth.user.emailVerified,
        mfaEnabled: auth.user.mfaEnabled,
        role: auth.user.role,
        reauthValid: isRecent(auth),
      };
    });

    app.patch("/me", async (request) => {
      const auth = requireAuth(request);
      const input = parse(updateProfileSchema, request.body);
      await ctx.db
        .update(users)
        .set({ ...input, updatedAt: ctx.now() })
        .where(eq(users.id, auth.userId));
      await writeAudit(ctx.db, {
        actorId: auth.userId,
        action: "account.profile_updated",
        targetType: "user",
        targetId: auth.userId,
        ipHash: request.ipHash,
        metadata: { fields: Object.keys(input).sort().join(",") },
      });
      const locale = input.locale ?? request.locale;
      return { displayName: input.displayName ?? auth.user.displayName, locale, dir: textDirection(locale) };
    });

    app.get("/me/sessions", async (request) => {
      const auth = requireAuth(request);
      const rows = await ctx.db
        .select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, userAgent: sessions.userAgent })
        .from(sessions)
        .where(eq(sessions.userId, auth.userId))
        .orderBy(desc(sessions.lastSeenAt));
      return { items: rows.map((r) => ({ ...r, current: r.id === auth.sessionId })) };
    });

    app.get("/me/consents", async (request) => {
      const auth = requireAuth(request);
      const rows = await ctx.db
        .select({ purpose: consents.purpose, policyVersion: consents.policyVersion, grantedAt: consents.grantedAt, withdrawnAt: consents.withdrawnAt })
        .from(consents)
        .where(eq(consents.userId, auth.userId))
        .orderBy(desc(consents.grantedAt));
      return { items: rows };
    });

    app.post("/me/consents", async (request) => {
      const auth = requireVerified(request);
      const { purpose, granted } = parse(consentChangeSchema, request.body);
      const now = ctx.now();
      await ctx.db.transaction(async (tx) => {
        // Close any active grant, then record a new one if granting (keeps a history).
        await tx
          .update(consents)
          .set({ withdrawnAt: now })
          .where(and(eq(consents.userId, auth.userId), eq(consents.purpose, purpose), isNull(consents.withdrawnAt)));
        if (granted) {
          await tx.insert(consents).values({ userId: auth.userId, purpose, policyVersion: CURRENT_TERMS_VERSION, grantedAt: now });
        }
        await writeAudit(tx, {
          actorId: auth.userId,
          action: granted ? "consent.granted" : "consent.withdrawn",
          targetType: "user",
          targetId: auth.userId,
          ipHash: request.ipHash,
          metadata: { purpose },
        });
      });
      return { purpose, granted };
    });

    /** Data portability (GDPR art. 20 / Israeli right of access). */
    app.get("/me/export", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
      const auth = requireRecentReauth(request, isRecent);
      const [user] = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          locale: users.locale,
          emailVerifiedAt: users.emailVerifiedAt,
          mfaEnabledAt: users.mfaEnabledAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, auth.userId));
      const consentRows = await ctx.db.select().from(consents).where(eq(consents.userId, auth.userId));
      const [vaultRow] = await ctx.db.select({ id: legacyVaults.id }).from(legacyVaults).where(eq(legacyVaults.legatorUserId, auth.userId));
      const vault = vaultRow ? await vaults.export(auth.userId, request.ipHash, request.locale) : null;
      await writeAudit(ctx.db, { actorId: auth.userId, action: "account.exported", targetType: "user", targetId: auth.userId, ipHash: request.ipHash });
      reply.header("Content-Disposition", 'attachment; filename="my-data.json"');
      return {
        exportedAt: ctx.now().toISOString(),
        user,
        consents: consentRows.map(({ purpose, policyVersion, grantedAt, withdrawnAt }) => ({ purpose, policyVersion, grantedAt, withdrawnAt })),
        vault,
      };
    });

    /** Permanent account deletion (cascades to sessions, vault and all vault content). */
    app.delete("/me", async (request, reply) => {
      const auth = requireRecentReauth(request, isRecent);
      // Vault first: also removes its media files from object storage.
      await vaults.deleteIfExists(auth.userId, request.ipHash);
      await ctx.db.transaction(async (tx) => {
        await tx.delete(users).where(eq(users.id, auth.userId));
        await writeAudit(tx, { actorId: auth.userId, action: "account.deleted", targetType: "user", targetId: auth.userId, ipHash: request.ipHash });
      });
      reply.clearCookie(ctx.env.SESSION_COOKIE_NAME, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      return reply.status(204).send();
    });
  };
}
