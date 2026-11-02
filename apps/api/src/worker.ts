import { UnrecoverableError, Worker, Queue } from "bullmq";
import pino from "pino";
import { loadEnv } from "./config/env.js";
import { createContext } from "./context.js";
import { createDb } from "./db/client.js";
import { MEDIA_QUEUE_NAME, redisConnection, type MediaJob } from "./lib/queue.js";
import { MediaProcessor, RetryableScanError } from "./modules/media/media.processor.js";
import { MediaService } from "./modules/media/media.service.js";
import { TranscriptionService } from "./modules/media/transcription.service.js";
import { CaptureService } from "./modules/capture/capture.service.js";
import { RetentionService } from "./modules/ops/retention.service.js";
import { MessagesService } from "./modules/messages/messages.service.js";
import { ReleaseService } from "./modules/release/release.service.js";
import { VaultService } from "./modules/vault/vault.service.js";

/**
 * Media worker process: verifies, scans and finalizes uploads; periodically cleans up
 * abandoned upload reservations. Run separately from the API: `node dist/worker.js`.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL, base: { service: "inother-worker" } });
  const dbHandle = createDb(env.DATABASE_URL, 5);
  const ctx = createContext(env, dbHandle.db, log);
  const processor = new MediaProcessor(ctx);
  const vaultService = new VaultService(ctx);
  const mediaService = new MediaService(ctx, vaultService);
  const releaseService = new ReleaseService(ctx, vaultService);
  const transcriptionService = new TranscriptionService(ctx, vaultService);
  const messagesService = new MessagesService(ctx, vaultService);
  const captureService = new CaptureService(ctx, vaultService, mediaService);
  const retentionService = new RetentionService(ctx);
  const connection = redisConnection(env.REDIS_URL);

  const worker = new Worker<MediaJob>(
    MEDIA_QUEUE_NAME,
    async (job) => {
      if (job.data.type === "finalize_releases") {
        const released = await releaseService.finalizeDue();
        if (released > 0) {
          log.info({ released }, "vaults released after waiting period");
          // "On release" letters should be waiting when beneficiaries first open the vault.
          log.info(await messagesService.deliverDue(), "scheduled messages");
        }
        return;
      }
      if (job.data.type === "retention") {
        log.info(await retentionService.run(), "retention purge");
        return;
      }
      if (job.data.type === "weekly_questions") {
        const sent = await captureService.sendWeekly();
        if (sent > 0) log.info({ sent }, "weekly questions sent");
        return;
      }
      if (job.data.type === "deliver_messages") {
        const result = await messagesService.deliverDue();
        if (result.initialized + result.delivered > 0) log.info(result, "scheduled messages");
        return;
      }
      if (job.data.type === "transcribe") {
        const outcome = await transcriptionService.process(job.data.assetId); // throws -> BullMQ retries
        log.info({ assetId: job.data.assetId, outcome }, "transcription");
        return;
      }
      if (job.data.type === "cleanup") {
        const removed = await mediaService.cleanupStalePending();
        log.info({ removed }, "cleaned up stale upload reservations");
        return;
      }
      try {
        const outcome = await processor.process(job.data.assetId);
        log.info({ assetId: job.data.assetId, outcome }, "media processed");
      } catch (err) {
        if (err instanceof RetryableScanError) throw err; // BullMQ retries with backoff
        log.error({ err, assetId: job.data.assetId }, "media processing failed");
        throw new UnrecoverableError("processing failed");
      }
    },
    { connection, concurrency: 2 },
  );

  // Hourly cleanup of abandoned reservations.
  const scheduler = new Queue<MediaJob>(MEDIA_QUEUE_NAME, { connection });
  await scheduler.upsertJobScheduler("cleanup-stale-uploads", { every: 3600_000 }, { name: "cleanup", data: { type: "cleanup" } });
  await scheduler.upsertJobScheduler("retention", { every: 24 * 3600_000 }, { name: "retention", data: { type: "retention" } });
  await scheduler.upsertJobScheduler("weekly-questions", { every: 3600_000 }, { name: "weekly_questions", data: { type: "weekly_questions" } });
  await scheduler.upsertJobScheduler("deliver-messages", { every: 3600_000 }, { name: "deliver_messages", data: { type: "deliver_messages" } });
  await scheduler.upsertJobScheduler("finalize-releases", { every: 15 * 60_000 }, { name: "finalize_releases", data: { type: "finalize_releases" } });

  const shutdown = async () => {
    log.info("worker shutting down");
    await worker.close();
    await scheduler.close();
    await ctx.mediaQueue.close();
    await ctx.redis?.quit().catch(() => ctx.redis?.disconnect());
    await dbHandle.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  log.info({ scanner: ctx.scanner.name, storage: env.STORAGE_DRIVER }, "media worker started");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
