import type { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { AppContext } from "../context.js";
import { AppError, forbidden } from "../lib/errors.js";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Registers transport-level protections:
 * - Security headers (API serves JSON only: CSP 'none', no framing, HSTS).
 * - CORS restricted to the web origin with credentials.
 * - CSRF defense in depth: SameSite cookies + strict Origin check on state-changing requests.
 * - Global rate limit (per-route limits are stricter for auth endpoints).
 */
export async function registerSecurity(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
  });

  await app.register(cors, {
    origin: [ctx.env.WEB_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "X-Capture-Token"],
    maxAge: 600,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: ctx.env.RATE_LIMIT_GLOBAL_PER_MINUTE,
    timeWindow: "1 minute",
    // Shared counters across instances when RATE_LIMIT_STORE=redis (required in production);
    // otherwise brute-force limits multiply by the number of instances.
    ...(ctx.redis ? { redis: ctx.redis, nameSpace: "inother-rl:" } : {}),
    // Fail closed: if the counter store is unavailable, refuse rather than allow unlimited attempts.
    skipOnError: false,
    keyGenerator: (req) => req.ipHash,
    errorResponseBuilder: (_req, context) => {
      const err = new AppError(429, "too_many_requests");
      (err as AppError & { retryAfterSeconds?: number }).retryAfterSeconds = Math.ceil(context.ttl / 1000);
      return err;
    },
  });

  const allowedOrigin = new URL(ctx.env.WEB_ORIGIN).origin;
  app.addHook("onRequest", async (request) => {
    if (!STATE_CHANGING.has(request.method)) return;
    if (request.url.startsWith("/webhooks/")) return; // signed separately (future)
    const origin = request.headers.origin;
    if (origin !== allowedOrigin) throw forbidden("invalid_origin");
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    return payload;
  });
}
