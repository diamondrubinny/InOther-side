import type { FastifyReply, FastifyRequest } from "fastify";
import type { Locale } from "@inother/shared";
import type { AuthenticatedSession } from "../modules/auth/session.service.js";
import { AppError, forbidden, notFound, unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthenticatedSession | null;
    /** HMAC of the client IP: lets us correlate abuse without storing raw IPs. */
    ipHash: string;
    /** Resolved language: ?locale= query, else the signed-in user's preference, else Accept-Language. */
    locale: Locale;
  }
}

/** Returns the authenticated session or throws 401. */
export function requireAuth(request: FastifyRequest): AuthenticatedSession {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

/** Authenticated + verified email. */
export function requireVerified(request: FastifyRequest): AuthenticatedSession {
  const auth = requireAuth(request);
  if (!auth.user.emailVerified) throw forbidden("email_not_verified");
  return auth;
}

/** For destructive or high-risk actions: the user must have re-entered credentials recently. */
export function requireRecentReauth(request: FastifyRequest, isRecent: (s: AuthenticatedSession) => boolean): AuthenticatedSession {
  const auth = requireVerified(request);
  if (!isRecent(auth)) throw new AppError(403, "reauth_required");
  return auth;
}

/**
 * Staff actions (reviewing death certificates) require: staff role, MFA enabled, and a
 * recent re-authentication. Non-staff get 404 so the admin surface is not discoverable.
 */
export function requireStaff(request: FastifyRequest, isRecent: (s: AuthenticatedSession) => boolean): AuthenticatedSession {
  const auth = requireVerified(request);
  if (auth.user.role !== "staff") throw notFound();
  if (!auth.user.mfaEnabled) throw forbidden("mfa_required_for_staff");
  if (!isRecent(auth)) throw new AppError(403, "reauth_required");
  return auth;
}

export function sessionMeta(request: FastifyRequest) {
  const ua = request.headers["user-agent"];
  return { ipHash: request.ipHash, userAgent: typeof ua === "string" ? ua : null };
}

export type Reply = FastifyReply;
