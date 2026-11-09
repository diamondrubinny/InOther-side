import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { z } from "zod";
import {
  RELEASE_DOCUMENT_MAX_BYTES,
  rejectReleaseSchema,
  reportDeathSchema,
  tokenBodySchema,
  uuidParamSchema,
} from "@inother/shared";
import { requireStaff, requireVerified } from "../../http/auth-guard.js";
import { parse } from "../../lib/validate.js";
import type { SessionService } from "../auth/session.service.js";
import type { InheritanceService } from "./inheritance.service.js";
import type { ReleaseService } from "./release.service.js";

const vaultParam = z.object({ vaultId: z.uuid() });
const vaultMediaParam = z.object({ vaultId: z.uuid(), mediaId: z.uuid() });
const strict = (max: number, minutes: number) => ({ config: { rateLimit: { max, timeWindow: `${minutes} minutes` } } });

export function releaseRoutes(release: ReleaseService, inheritance: InheritanceService, sessions: SessionService) {
  const isRecent = sessions.isRecentlyReauthenticated.bind(sessions);

  return async function (app: FastifyInstance): Promise<void> {
    app.addContentTypeParser(/^(application\/pdf|image\/(jpeg|png))$/i, (_req, payload, done) => done(null, payload));

    // ---- Legator ----
    app.post("/vault/executors/:id/invite", strict(20, 60), async (request, reply) => {
      const { userId } = requireVerified(request);
      await release.inviteExecutor(userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      return reply.status(202).send({ status: "invited" });
    });
    app.post("/vault/beneficiaries/:id/invite", strict(20, 60), async (request, reply) => {
      const { userId } = requireVerified(request);
      await release.inviteBeneficiary(userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      return reply.status(202).send({ status: "invited" });
    });
    app.get("/vault/release", async (request) => {
      const { userId } = requireVerified(request);
      return release.legatorStatus(userId);
    });
    app.post("/vault/release/cancel", async (request, reply) => {
      const { userId } = requireVerified(request);
      await release.cancelByLegator(userId, request.ipHash);
      return reply.send({ status: "cancelled" });
    });
    // Emailed "I'm alive" link: no sign-in required, single-purpose token.
    app.post("/release/cancel", strict(10, 15), async (request, reply) => {
      const { token } = parse(tokenBodySchema, request.body);
      await release.cancelByToken(token, request.ipHash);
      return reply.send({ status: "cancelled" });
    });

    // ---- Invitees ----
    app.post("/invitations/accept", strict(20, 15), async (request) => {
      const auth = requireVerified(request);
      const { token } = parse(tokenBodySchema, request.body);
      return release.acceptInvitation(auth.userId, auth.user.email, token, request.ipHash);
    });

    // ---- Executors ----
    app.get("/executor/vaults", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await release.executorRoles(userId) };
    });
    app.post("/executor/vaults/:vaultId/reports", strict(5, 60), async (request, reply) => {
      const { userId } = requireVerified(request);
      const { vaultId } = parse(vaultParam, request.params);
      const { dateOfDeath, afterSunset } = parse(reportDeathSchema, request.body);
      return reply.status(201).send(await release.reportDeath(userId, vaultId, dateOfDeath, request.ipHash, afterSunset));
    });
    app.put(
      "/executor/reports/:id/document",
      { bodyLimit: RELEASE_DOCUMENT_MAX_BYTES, ...strict(10, 60) },
      async (request, reply) => {
        const { userId } = requireVerified(request);
        const { id } = parse(uuidParamSchema, request.params);
        const len = request.headers["content-length"];
        const result = await release.uploadDocument(
          userId,
          id,
          request.body as Readable,
          request.headers["content-type"],
          len !== undefined && /^\d+$/.test(len) ? Number(len) : undefined,
          request.ipHash,
        );
        return reply.status(202).send(result);
      },
    );
    app.post("/executor/reports/:id/confirm", async (request, reply) => {
      const { userId } = requireVerified(request);
      await release.confirmAsSecondExecutor(userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      return reply.send({ status: "confirmed" });
    });

    // ---- Staff ----
    app.get("/admin/release-requests", async (request) => {
      requireStaff(request, isRecent);
      return { items: await release.pendingReviews() };
    });
    app.get("/admin/release-requests/:id/document", async (request, reply) => {
      const auth = requireStaff(request, isRecent);
      const doc = await release.reviewDocument(auth.userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      reply
        .type(doc.mime)
        .header("Content-Length", String(doc.size))
        .header("Content-Disposition", "attachment; filename=\"document\"")
        .header("Cache-Control", "private, no-store");
      return reply.send(doc.stream);
    });
    app.post("/admin/release-requests/:id/approve", async (request, reply) => {
      const auth = requireStaff(request, isRecent);
      await release.approve(auth.userId, parse(uuidParamSchema, request.params).id, request.ipHash);
      return reply.send({ status: "approved" });
    });
    app.post("/admin/release-requests/:id/reject", async (request, reply) => {
      const auth = requireStaff(request, isRecent);
      const { reason } = parse(rejectReleaseSchema, request.body);
      await release.reject(auth.userId, parse(uuidParamSchema, request.params).id, reason, request.ipHash);
      return reply.send({ status: "rejected" });
    });

    // ---- Beneficiaries (released vaults only) ----
    app.get("/inheritances", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await inheritance.list(userId) };
    });
    app.get("/inheritances/:vaultId", async (request) => {
      const { userId } = requireVerified(request);
      return inheritance.summary(userId, parse(vaultParam, request.params).vaultId, request.ipHash);
    });
    app.get("/inheritances/:vaultId/answers", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await inheritance.answers(userId, parse(vaultParam, request.params).vaultId, request.locale) };
    });
    app.get("/inheritances/:vaultId/stories", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await inheritance.stories(userId, parse(vaultParam, request.params).vaultId) };
    });
    app.get("/inheritances/:vaultId/book", async (request) => {
      const { userId } = requireVerified(request);
      return inheritance.book(userId, parse(vaultParam, request.params).vaultId, request.locale);
    });

    app.get("/inheritances/:vaultId/media", async (request) => {
      const { userId } = requireVerified(request);
      return { items: await inheritance.media(userId, parse(vaultParam, request.params).vaultId) };
    });
    app.get("/inheritances/:vaultId/media/:mediaId/content", async (request, reply) => {
      const { userId } = requireVerified(request);
      const { vaultId, mediaId } = parse(vaultMediaParam, request.params);
      const file = await inheritance.mediaContent(userId, vaultId, mediaId);
      reply
        .type(file.mime)
        .header("Content-Length", String(file.size))
        .header("Content-Disposition", `attachment; filename="${mediaId}"`)
        .header("Cache-Control", "private, no-store");
      return reply.send(file.stream);
    });
  };
}
