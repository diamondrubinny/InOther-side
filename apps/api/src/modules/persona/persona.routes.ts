import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidParamSchema } from "@inother/shared";
import { requireVerified } from "../../http/auth-guard.js";
import { AppError } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";
import type { PersonaService } from "./persona.service.js";

const vaultParam = z.object({ vaultId: z.uuid() });
const segmentParam = z.object({ id: z.uuid(), segmentId: z.uuid() });
const startSchema = z.object({ kind: z.enum(["regular", "farewell"]).default("regular") });
const messageSchema = z.object({ text: z.string().trim().min(1).max(2000) });
const settingsSchema = z
  .object({
    portraitMediaId: z.uuid().nullable(),
    mouthX: z.number().int().min(0).max(1000),
    mouthY: z.number().int().min(0).max(1000),
    sessionsLimit: z.number().int().min(1).max(50),
    minutesLimit: z.number().int().min(5).max(120),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: "empty_update" });

export function personaRoutes(persona: PersonaService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/persona/vaults/:vaultId", async (request) => {
      const { userId } = requireVerified(request);
      return persona.overview(userId, parse(vaultParam, request.params).vaultId);
    });

    app.get("/persona/vaults/:vaultId/portrait", async (request, reply) => {
      const { userId } = requireVerified(request);
      const img = await persona.portrait(userId, parse(vaultParam, request.params).vaultId);
      reply.type(img.mime).header("Content-Length", String(img.size)).header("Cache-Control", "private, no-store");
      return reply.send(img.stream);
    });

    app.post("/persona/vaults/:vaultId/sessions", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request, reply) => {
      const { userId } = requireVerified(request);
      const { kind } = parse(startSchema, request.body ?? {});
      const session = await persona.start(userId, parse(vaultParam, request.params).vaultId, kind, request.locale, request.ipHash);
      return reply.status(201).send(session);
    });

    /** Server-Sent Events: text deltas, speakable segments, original stories, safety events. */
    app.post("/persona/sessions/:id/messages", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      const { text } = parse(messageSchema, request.body);
      // Pull the first event before switching to streaming, so auth/limit errors return normal JSON.
      const controller = new AbortController();
      const iterator = persona.message(id, userId, text, controller.signal)[Symbol.asyncIterator]();
      const first = await iterator.next();

      // Hijacked responses skip Fastify's onSend hooks: carry over CORS + security headers.
      reply.hijack();
      const headers: Record<string, string | number | string[]> = {};
      for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string;
      reply.raw.writeHead(200, {
        ...headers,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      request.raw.on("close", () => controller.abort());
      const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      try {
        if (!first.done) send(first.value);
        for (let r = await iterator.next(); !r.done; r = await iterator.next()) {
          if (controller.signal.aborted) break;
          send(r.value);
        }
      } catch (err) {
        send({ type: "error", code: err instanceof AppError ? err.code : "internal_error" });
      } finally {
        reply.raw.end();
      }
    });

    app.get("/persona/sessions/:id/segments/:segmentId/audio", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { id, segmentId } = parse(segmentParam, request.params);
      const audio = await persona.segmentAudio(id, userId, segmentId);
      reply
        .type(audio.mime)
        .header("Cache-Control", "private, no-store")
        // Machine-readable disclosure that the audio is synthetic (EU AI Act art. 50 spirit).
        .header("X-AI-Generated", "true");
      return reply.send(audio.audio);
    });

    app.post("/persona/sessions/:id/end", async (request, reply) => {
      const { userId } = requireVerified(request);
      await persona.end(parse(uuidParamSchema, request.params).id, userId);
      return reply.status(204).send();
    });

    // Legator configuration
    app.get("/persona/settings", async (request) => {
      const { userId } = requireVerified(request);
      return persona.getSettings(userId);
    });
    app.patch("/persona/settings", async (request) => {
      const { userId } = requireVerified(request);
      return persona.updateSettings(userId, parse(settingsSchema, request.body), request.ipHash);
    });
    app.post("/persona/settings/voice", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request) => {
      const { userId } = requireVerified(request);
      return persona.cloneVoice(userId, request.ipHash);
    });
  };
}
