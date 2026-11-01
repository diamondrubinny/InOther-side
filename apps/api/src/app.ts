import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { DEFAULT_LOCALE, isLocale, negotiateLocale } from "@inother/shared";
import type { Env } from "./config/env.js";
import { createContext, type AppContext, type ContextOverrides } from "./context.js";
import { createDb, type DbHandle } from "./db/client.js";
import { registerErrorHandling } from "./http/error-handler.js";
import { registerSecurity } from "./http/security.js";
import { accountRoutes } from "./modules/account/account.routes.js";
import { messagesRoutes } from "./modules/messages/messages.routes.js";
import { MessagesService } from "./modules/messages/messages.service.js";
import { mediaRoutes } from "./modules/media/media.routes.js";
import { MediaService } from "./modules/media/media.service.js";
import { TranscriptionService } from "./modules/media/transcription.service.js";
import { InterviewService } from "./modules/persona/interview.service.js";
import { personaRoutes } from "./modules/persona/persona.routes.js";
import { PersonaService } from "./modules/persona/persona.service.js";
import { InheritanceService } from "./modules/release/inheritance.service.js";
import { releaseRoutes } from "./modules/release/release.routes.js";
import { ReleaseService } from "./modules/release/release.service.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { vaultRoutes } from "./modules/vault/vault.routes.js";
import { VaultService } from "./modules/vault/vault.service.js";

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildApp(env: Env, overrides: ContextOverrides & { dbHandle?: DbHandle } = {}): Promise<BuiltApp> {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
      // Never log credentials, cookies or bodies.
      redact: {
        paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.token"],
        censor: "[redacted]",
      },
      serializers: {
        // Drop client IP and query strings (may contain tokens) from request logs.
        req: (req) => ({ id: req.id, method: req.method, url: req.url.split("?")[0] }),
      },
    },
  });

  const dbHandle = overrides.dbHandle ?? createDb(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const ctx = createContext(env, dbHandle.db, app.log, overrides);
  if (!overrides.dbHandle) app.addHook("onClose", async () => dbHandle.close());
  app.addHook("onClose", async () => ctx.mediaQueue.close());

  const auth = new AuthService(ctx);
  const vaults = new VaultService(ctx);
  const media = new MediaService(ctx, vaults);
  const release = new ReleaseService(ctx, vaults);
  const inheritance = new InheritanceService(ctx, vaults);
  const persona = new PersonaService(ctx, vaults, ctx.llm, ctx.voice);
  const messages = new MessagesService(ctx, vaults);

  app.decorateRequest("auth", null);
  app.decorateRequest("ipHash", "");
  app.decorateRequest("locale", DEFAULT_LOCALE);
  // ipHash must exist before the rate limiter computes its key, so this hook is added first.
  app.addHook("onRequest", async (request) => {
    request.ipHash = ctx.hmac.hex(request.ip, "ip");
    request.locale = negotiateLocale(request.headers["accept-language"]);
  });

  registerErrorHandling(app);
  await registerSecurity(app, ctx);

  app.addHook("preHandler", async (request) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    request.auth = token ? await auth.sessions.validate(token) : null;
    const explicit = (request.query as Record<string, unknown> | undefined)?.locale;
    if (isLocale(explicit)) request.locale = explicit;
    else if (request.auth && isLocale(request.auth.user.locale)) request.locale = request.auth.user.locale;
  });

  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  await app.register(authRoutes(ctx, auth));
  await app.register(accountRoutes(ctx, auth.sessions, vaults, persona));
  await app.register(vaultRoutes(vaults, auth.sessions));
  await app.register(mediaRoutes(media, new TranscriptionService(ctx, vaults)));
  await app.register(releaseRoutes(release, inheritance, auth.sessions));
  await app.register(messagesRoutes(messages));
  await app.register(personaRoutes(persona, new InterviewService(ctx, vaults)));

  return { app, ctx };
}
