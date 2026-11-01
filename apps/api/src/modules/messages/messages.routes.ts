import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { messagesPauseSchema, scheduledMessageInputSchema, uuidParamSchema } from "@inother/shared";
import { requireVerified } from "../../http/auth-guard.js";
import { parse } from "../../lib/validate.js";
import type { MessagesService } from "./messages.service.js";

const vaultParam = z.object({ vaultId: z.uuid() });
const vaultItemParam = z.object({ vaultId: z.uuid(), id: z.uuid() });

export function messagesRoutes(messages: MessagesService) {
  return async function (app: FastifyInstance): Promise<void> {
    // Legator: compose and schedule (vault must still be editable).
    app.get("/vault/messages", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await messages.list(userId) };
    });
    app.post("/vault/messages", async (request, reply) => {
      const { userId } = requireVerified(request);
      return reply.status(201).send(await messages.create(userId, parse(scheduledMessageInputSchema, request.body), request.ipHash));
    });
    app.get("/vault/messages/:id", async (request) => {
      const { userId } = requireVerified(request);
      return messages.get(userId, parse(uuidParamSchema, request.params).id);
    });
    app.put("/vault/messages/:id", async (request) => {
      const { userId } = requireVerified(request);
      return messages.update(userId, parse(uuidParamSchema, request.params).id, parse(scheduledMessageInputSchema, request.body), request.ipHash);
    });
    app.delete("/vault/messages/:id", async (request, reply) => {
      const { userId } = requireVerified(request);
      await messages.delete(userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      return reply.status(204).send();
    });

    // Beneficiary: inbox of a released vault.
    app.get("/inheritances/:vaultId/messages", async (request) => {
      const { userId } = requireVerified(request);
      return messages.inbox(userId, parse(vaultParam, request.params).vaultId);
    });
    app.put("/inheritances/:vaultId/messages/pause", async (request) => {
      const { userId } = requireVerified(request);
      const { paused } = parse(messagesPauseSchema, request.body);
      return messages.setPaused(userId, parse(vaultParam, request.params).vaultId, paused, request.ipHash);
    });
    app.get("/inheritances/:vaultId/messages/:id", async (request) => {
      const { userId } = requireVerified(request);
      const { vaultId, id } = parse(vaultItemParam, request.params);
      return messages.read(userId, vaultId, id, request.ipHash);
    });
    app.post("/inheritances/:vaultId/messages/:id/open", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request, reply) => {
      const { userId } = requireVerified(request);
      const { vaultId, id } = parse(vaultItemParam, request.params);
      return reply.status(201).send(await messages.openLifeEvent(userId, vaultId, id, request.ipHash));
    });
    app.post("/inheritances/:vaultId/messages/:id/stop", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { vaultId, id } = parse(vaultItemParam, request.params);
      await messages.stop(userId, vaultId, id, request.ipHash);
      return reply.status(204).send();
    });
  };
}
