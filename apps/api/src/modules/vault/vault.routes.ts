import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LOCALE_INFO,
  SUPPORTED_LOCALES,
  localizedCatalog,
  textDirection,
  answerInputSchema,
  beneficiaryInputSchema,
  beneficiaryUpdateSchema,
  executorInputSchema,
  executorUpdateSchema,
  storyInputSchema,
  storyUpdateSchema,
  updateVaultSchema,
  uuidParamSchema,
} from "@inother/shared";
import { requireRecentReauth, requireVerified } from "../../http/auth-guard.js";
import { parse } from "../../lib/validate.js";
import type { SessionService } from "../auth/session.service.js";
import type { VaultService } from "./vault.service.js";

const createVaultSchema = z.object({
  /** Explicit, separate consent to store and process life-story data in the vault. */
  consentToProcessing: z.literal(true, { error: "consent_required" }),
});

const questionParamSchema = z.object({ questionId: z.string().regex(/^[a-z0-9_.-]{1,64}$/) });

export function vaultRoutes(vaults: VaultService, sessions: SessionService) {
  const isRecent = sessions.isRecentlyReauthenticated.bind(sessions);

  return async function (app: FastifyInstance): Promise<void> {
    // Public endpoints (no personal data).
    app.get("/locales", async () => ({
      default: "he",
      locales: SUPPORTED_LOCALES.map((code) => ({ code, ...LOCALE_INFO[code] })),
    }));

    app.get("/questions", async (request, reply) => {
      reply.header("Content-Language", request.locale).header("Vary", "Accept-Language");
      return { locale: request.locale, dir: textDirection(request.locale), topics: localizedCatalog(request.locale) };
    });

    app.post("/vault", async (request, reply) => {
      const { userId } = requireVerified(request);
      parse(createVaultSchema, request.body);
      await vaults.create(userId, request.ipHash);
      return reply.status(201).send(await vaults.summary(userId));
    });

    app.get("/vault", async (request) => {
      const { userId } = requireVerified(request);
      return vaults.summary(userId);
    });

    app.patch("/vault", async (request) => {
      const { userId } = requireVerified(request);
      await vaults.update(userId, parse(updateVaultSchema, request.body), request.ipHash);
      return vaults.summary(userId);
    });

    app.get("/vault/book", async (request) => {
      const { userId } = requireVerified(request);
      return vaults.book(userId, request.locale);
    });

    app.delete("/vault", async (request, reply) => {
      const { userId } = requireRecentReauth(request, isRecent);
      await vaults.delete(userId, request.ipHash);
      return reply.status(204).send();
    });

    app.get("/vault/export", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
      const { userId } = requireRecentReauth(request, isRecent);
      const data = await vaults.export(userId, request.ipHash, request.locale);
      reply.header("Content-Disposition", 'attachment; filename="legacy-export.json"');
      return data;
    });

    // Beneficiaries
    app.get("/vault/beneficiaries", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await vaults.listBeneficiaries(userId) };
    });
    app.post("/vault/beneficiaries", async (request, reply) => {
      const { userId } = requireVerified(request);
      const created = await vaults.addBeneficiary(userId, parse(beneficiaryInputSchema, request.body), request.ipHash);
      return reply.status(201).send(created);
    });
    app.patch("/vault/beneficiaries/:id", async (request) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      return vaults.updateBeneficiary(userId, id, parse(beneficiaryUpdateSchema, request.body), request.ipHash);
    });
    app.delete("/vault/beneficiaries/:id", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      await vaults.deleteBeneficiary(userId, id, request.ipHash);
      return reply.status(204).send();
    });

    // Executors
    app.get("/vault/executors", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await vaults.listExecutors(userId) };
    });
    app.post("/vault/executors", async (request, reply) => {
      const { userId } = requireVerified(request);
      const created = await vaults.addExecutor(userId, parse(executorInputSchema, request.body), request.ipHash);
      return reply.status(201).send(created);
    });
    app.patch("/vault/executors/:id", async (request) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      return vaults.updateExecutor(userId, id, parse(executorUpdateSchema, request.body), request.ipHash);
    });
    app.delete("/vault/executors/:id", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      await vaults.deleteExecutor(userId, id, request.ipHash);
      return reply.status(204).send();
    });

    // Sealed stories
    app.get("/vault/stories", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await vaults.listStories(userId) };
    });
    app.get("/vault/stories/:id", async (request) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      return vaults.getStory(userId, id);
    });
    app.post("/vault/stories", async (request, reply) => {
      const { userId } = requireVerified(request);
      const created = await vaults.createStory(userId, parse(storyInputSchema, request.body), request.ipHash);
      return reply.status(201).send(created);
    });
    app.put("/vault/stories/:id", async (request) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      return vaults.updateStory(userId, id, parse(storyUpdateSchema, request.body), request.ipHash);
    });
    app.delete("/vault/stories/:id", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { id } = parse(uuidParamSchema, request.params);
      await vaults.deleteStory(userId, id, request.ipHash);
      return reply.status(204).send();
    });

    // Guided answers
    app.get("/vault/answers", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await vaults.listAnswers(userId) };
    });
    app.put("/vault/answers/:questionId", async (request) => {
      const { userId } = requireVerified(request);
      const { questionId } = parse(questionParamSchema, request.params);
      const body = parse(answerInputSchema.omit({ questionId: true }), request.body);
      return vaults.saveAnswer(userId, { questionId, text: body.text }, request.ipHash);
    });
    app.delete("/vault/answers/:questionId", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { questionId } = parse(questionParamSchema, request.params);
      await vaults.deleteAnswer(userId, questionId, request.ipHash);
      return reply.status(204).send();
    });
  };
}
