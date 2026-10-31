import type { FastifyError, FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";

interface ErrorBody {
  error: { code: string; details?: unknown; requestId: string };
}

/**
 * One place that turns errors into safe JSON. Internal errors are logged with the request id
 * and returned as a generic message: no stack traces, SQL or internal details reach clients.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    if (error instanceof AppError) {
      const body: ErrorBody = { error: { code: error.code, requestId: request.id } };
      if (error.details !== undefined) body.error.details = error.details;
      const retryAfter = (error as AppError & { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retryAfter) reply.header("Retry-After", String(retryAfter));
      if (error.statusCode >= 500) request.log.error({ err: error }, "application error");
      return reply.status(error.statusCode).send(body);
    }

    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (status < 500) {
      // Fastify-level client errors: malformed JSON, payload too large, unsupported media type...
      const code =
        error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? "payload_too_large"
          : error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
            ? "unsupported_media_type"
            : error.code === "FST_ERR_CTP_EMPTY_JSON_BODY" || error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
              ? "invalid_json"
              : "bad_request";
      return reply.status(status).send({ error: { code, requestId: request.id } } satisfies ErrorBody);
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal_error", requestId: request.id } } satisfies ErrorBody);
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ error: { code: "route_not_found", requestId: request.id } } satisfies ErrorBody);
  });
}
