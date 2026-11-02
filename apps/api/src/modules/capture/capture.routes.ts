import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { z } from "zod";
import {
  captureAnswerSchema,
  capturePreferencesSchema,
  captureTokenSchema,
  createCaptureLinkSchema,
  suggestionInputSchema,
  uuidParamSchema,
} from "@inother/shared";
import type { AppContext } from "../../context.js";
import { requireVerified } from "../../http/auth-guard.js";
import { parse } from "../../lib/validate.js";
import type { CaptureService } from "./capture.service.js";

const sendSchema = z.object({ sendToMyEmail: z.boolean().default(false) });
const vaultParam = z.object({ vaultId: z.uuid() });

export function captureRoutes(ctx: AppContext, capture: CaptureService) {
  /** Strict per-IP limits on the public, token-based endpoints. */
  const strict = (max: number, timeWindow: string) => ({ config: { rateLimit: { max: max * ctx.env.AUTH_RATE_LIMIT_MULTIPLIER, timeWindow } } });

  return async function (app: FastifyInstance): Promise<void> {
    app.addContentTypeParser(/^audio\/[a-z0-9.+-]+$/i, (_req, payload, done) => done(null, payload));

    // Legator
    app.get("/vault/capture-links", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await capture.listLinks(userId, request.locale) };
    });
    app.post("/vault/capture-links", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request, reply) => {
      const { userId } = requireVerified(request);
      const input = parse(createCaptureLinkSchema, request.body);
      const { sendToMyEmail } = parse(sendSchema, { sendToMyEmail: (request.body as { sendToMyEmail?: unknown } | null)?.sendToMyEmail });
      return reply.status(201).send(await capture.createLink(userId, input, sendToMyEmail, request.locale, request.ipHash));
    });
    app.delete("/vault/capture-links/:id", async (request, reply) => {
      const { userId } = requireVerified(request);
      await capture.revokeLink(userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      return reply.status(204).send();
    });
    app.get("/vault/capture-preferences", async (request) => {
      const { userId } = requireVerified(request);
      return capture.getPreferences(userId);
    });
    app.put("/vault/capture-preferences", async (request) => {
      const { userId } = requireVerified(request);
      return capture.setPreferences(userId, parse(capturePreferencesSchema, request.body), request.ipHash);
    });
    app.get("/vault/suggestions", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await capture.listSuggestions(userId) };
    });
    app.post("/vault/suggestions/:id/accept", async (request, reply) => {
      const { userId } = requireVerified(request);
      await capture.decideSuggestion(userId, parse(uuidParamSchema, request.params).id, "accepted", request.ipHash);
      return reply.status(204).send();
    });
    app.post("/vault/suggestions/:id/dismiss", async (request, reply) => {
      const { userId } = requireVerified(request);
      await capture.decideSuggestion(userId, parse(uuidParamSchema, request.params).id, "dismissed", request.ipHash);
      return reply.status(204).send();
    });

    // Family (accepted beneficiary, legator alive)
    app.get("/inheritances/:vaultId/suggestions", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await capture.mySuggestions(userId, parse(vaultParam, request.params).vaultId) };
    });
    app.post("/inheritances/:vaultId/suggestions", { config: { rateLimit: { max: 20, timeWindow: "1 day" } } }, async (request, reply) => {
      const { userId } = requireVerified(request);
      const { text } = parse(suggestionInputSchema, request.body);
      return reply.status(201).send(await capture.suggest(userId, parse(vaultParam, request.params).vaultId, text, request.ipHash));
    });

    // Public: whoever holds a capture link. The token travels in the body/header, never in the URL.
    app.post("/capture/session", strict(30, "15 minutes"), async (request) => {
      const { token } = parse(captureTokenSchema, request.body);
      return capture.session(token, request.locale);
    });
    app.post("/capture/answer", strict(10, "15 minutes"), async (request, reply) => {
      const { token, text } = parse(captureAnswerSchema, request.body);
      return reply.status(201).send(await capture.answerText(token, text, request.ipHash));
    });
    app.put("/capture/audio", { ...strict(10, "1 hour"), bodyLimit: 101 * 1024 * 1024 }, async (request, reply) => {
      const header = request.headers["x-capture-token"];
      const { token } = parse(captureTokenSchema, { token: typeof header === "string" ? header : "" });
      const length = Number(request.headers["content-length"]);
      const result = await capture.answerAudio(token, request.body as Readable, request.headers["content-type"], Number.isFinite(length) ? length : undefined, request.ipHash);
      return reply.status(201).send(result);
    });
  };
}
