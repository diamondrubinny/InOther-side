import type { FastifyInstance, FastifyReply } from "fastify";
import {
  changePasswordSchema,
  loginMfaSchema,
  loginSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  reauthSchema,
  registerSchema,
  verifyEmailSchema,
} from "@inother/shared";
import type { AppContext } from "../../context.js";
import { requireAuth, requireRecentReauth, requireVerified, sessionMeta } from "../../http/auth-guard.js";
import { parse } from "../../lib/validate.js";
import type { AuthService } from "./auth.service.js";

/** Strict limits for credential endpoints (per client IP). */
const strict = (max: number, minutes: number) => ({
  config: { rateLimit: { max, timeWindow: `${minutes} minutes` } },
});

export function authRoutes(ctx: AppContext, auth: AuthService) {
  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) => {
    reply.setCookie(ctx.env.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  };
  const clearSessionCookie = (reply: FastifyReply) => {
    reply.clearCookie(ctx.env.SESSION_COOKIE_NAME, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  };
  const isRecent = auth.sessions.isRecentlyReauthenticated.bind(auth.sessions);

  return async function (app: FastifyInstance): Promise<void> {
    app.post("/auth/register", strict(5, 15), async (request, reply) => {
      const input = parse(registerSchema, request.body);
      await auth.register(input, sessionMeta(request), request.locale);
      // Identical response whether or not the email already existed.
      return reply.status(202).send({ status: "check_your_email" });
    });

    app.post("/auth/verify-email", strict(20, 15), async (request, reply) => {
      const { token } = parse(verifyEmailSchema, request.body);
      await auth.verifyEmail(token, request.ipHash);
      return reply.send({ status: "verified" });
    });

    app.post("/auth/resend-verification", strict(3, 15), async (request, reply) => {
      const session = requireAuth(request);
      await auth.resendVerification(session.userId);
      return reply.status(202).send({ status: "check_your_email" });
    });

    app.post("/auth/login", strict(10, 15), async (request, reply) => {
      const input = parse(loginSchema, request.body);
      const result = await auth.login(input, sessionMeta(request));
      if (result.kind === "mfa_required") {
        return reply.send({ status: "mfa_required", challengeToken: result.challengeToken });
      }
      setSessionCookie(reply, result.token, result.expiresAt);
      return reply.send({ status: "authenticated" });
    });

    app.post("/auth/login/mfa", strict(10, 15), async (request, reply) => {
      const input = parse(loginMfaSchema, request.body);
      const session = await auth.completeMfaLogin(input, sessionMeta(request));
      setSessionCookie(reply, session.token, session.expiresAt);
      return reply.send({ status: "authenticated" });
    });

    app.post("/auth/logout", async (request, reply) => {
      if (request.auth) {
        await auth.sessions.revoke(request.auth.sessionId);
      }
      clearSessionCookie(reply);
      return reply.status(204).send();
    });

    app.post("/auth/logout-all", async (request, reply) => {
      const session = requireAuth(request);
      await auth.sessions.revokeAll(session.userId);
      clearSessionCookie(reply);
      return reply.status(204).send();
    });

    app.post("/auth/password-reset/request", strict(5, 15), async (request, reply) => {
      const { email } = parse(passwordResetRequestSchema, request.body);
      await auth.requestPasswordReset(email, request.ipHash);
      return reply.status(202).send({ status: "check_your_email" });
    });

    app.post("/auth/password-reset/confirm", strict(10, 15), async (request, reply) => {
      const { token, newPassword } = parse(passwordResetConfirmSchema, request.body);
      await auth.confirmPasswordReset(token, newPassword, request.ipHash);
      clearSessionCookie(reply);
      return reply.send({ status: "password_reset" });
    });

    app.post("/auth/password/change", strict(5, 15), async (request, reply) => {
      const session = requireVerified(request);
      const { currentPassword, newPassword } = parse(changePasswordSchema, request.body);
      await auth.changePassword(session.userId, session.sessionId, currentPassword, newPassword, request.ipHash);
      return reply.send({ status: "password_changed" });
    });

    app.post("/auth/reauth", strict(10, 15), async (request, reply) => {
      const session = requireVerified(request);
      const { password, code } = parse(reauthSchema, request.body);
      await auth.reauthenticate(session.userId, session.sessionId, password, code, request.ipHash);
      return reply.send({ status: "reauthenticated", validForMinutes: ctx.env.REAUTH_WINDOW_MINUTES });
    });

    app.post("/auth/mfa/setup", strict(5, 15), async (request, reply) => {
      const session = requireRecentReauth(request, isRecent);
      const setup = await auth.mfa.beginSetup(session.userId, session.user.email);
      return reply.send(setup);
    });

    app.post("/auth/mfa/confirm", strict(10, 15), async (request, reply) => {
      const session = requireRecentReauth(request, isRecent);
      const { code } = parse(mfaConfirmSchema, request.body);
      const recoveryCodes = await auth.mfa.confirmSetup(session.userId, code, request.ipHash);
      return reply.send({ status: "mfa_enabled", recoveryCodes });
    });

    app.post("/auth/mfa/disable", strict(5, 15), async (request, reply) => {
      const session = requireRecentReauth(request, isRecent);
      const { code } = parse(mfaDisableSchema, request.body);
      await auth.mfa.disable(session.userId, code, request.ipHash);
      return reply.send({ status: "mfa_disabled" });
    });
  };
}
