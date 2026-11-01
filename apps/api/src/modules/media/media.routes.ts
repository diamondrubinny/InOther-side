import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { MAX_MEDIA_BYTES, createMediaSchema, updateMediaSchema, uuidParamSchema } from "@inother/shared";
import { requireVerified } from "../../http/auth-guard.js";
import { parse } from "../../lib/validate.js";
import { z } from "zod";
import type { MediaService } from "./media.service.js";
import type { TranscriptionService } from "./transcription.service.js";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/vnd.wave": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const transcriptSchema = z.object({ text: z.string().trim().min(1).max(200_000) });

export function mediaRoutes(media: MediaService, transcripts: TranscriptionService) {
  return async function (app: FastifyInstance): Promise<void> {
    // Raw streaming bodies for media uploads, scoped to this plugin only.
    app.addContentTypeParser(/^(image|audio|video)\/[a-z0-9.+-]+$/i, (_req, payload, done) => done(null, payload));

    app.get("/vault/media", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await media.list(userId) };
    });

    app.post("/vault/media", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (request, reply) => {
      const { userId } = requireVerified(request);
      const created = await media.create(userId, parse(createMediaSchema, request.body), request.ipHash);
      return reply.status(201).send({ ...created, uploadUrl: `/vault/media/${created.id}/content` });
    });

    app.put(
      "/vault/media/:id/content",
      {
        bodyLimit: MAX_MEDIA_BYTES.video,
        config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
      },
      async (request, reply) => {
        const { userId } = requireVerified(request);
        const { id } = parse(uuidParamSchema, request.params);
        const lengthHeader = request.headers["content-length"];
        const contentLength = lengthHeader !== undefined && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : undefined;
        const result = await media.upload(
          userId,
          id,
          request.body as Readable,
          request.headers["content-type"],
          contentLength,
          request.ipHash,
        );
        return reply.status(202).send(result);
      },
    );

    app.get("/vault/media/:id", async (request) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      return media.get(userId, id);
    });

    app.get("/vault/media/:id/content", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      const file = await media.content(userId, id);
      const ext = EXT_BY_MIME[file.mime] ?? "bin";
      reply
        .type(file.mime)
        .header("Content-Length", String(file.size))
        // Always a download: never rendered as a page on our origin.
        .header("Content-Disposition", `attachment; filename="${id}.${ext}"`)
        .header("Cache-Control", "private, no-store");
      return reply.send(file.stream);
    });

    app.get("/vault/media/:id/transcript", async (request) => {
      const { userId } = requireVerified(request);
      return transcripts.get(userId, parse(uuidParamSchema, request.params).id);
    });
    app.put("/vault/media/:id/transcript", async (request) => {
      const { userId } = requireVerified(request);
      const { text } = parse(transcriptSchema, request.body);
      return transcripts.update(userId, parse(uuidParamSchema, request.params).id, text, request.ipHash);
    });
    app.post("/vault/media/:id/transcript/retry", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request) => {
      const { userId } = requireVerified(request);
      return transcripts.retry(userId, parse(uuidParamSchema, request.params).id);
    });
    app.delete("/vault/media/:id/transcript", async (request, reply) => {
      const { userId } = requireVerified(request);
      await transcripts.delete(userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      return reply.status(204).send();
    });

    app.patch("/vault/media/:id", async (request) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      return media.update(userId, id, parse(updateMediaSchema, request.body), request.ipHash);
    });

    app.delete("/vault/media/:id", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      await media.delete(userId, id, request.ipHash);
      return reply.status(204).send();
    });
  };
}
