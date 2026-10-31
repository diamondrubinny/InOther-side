import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { BullMediaQueue, MEDIA_QUEUE_NAME, redisConnection, type MediaJob } from "../src/lib/queue.js";

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";

/** Verifies the real BullMQ wiring against Redis (jobs are delivered once, de-duplicated by asset id). */
describe("BullMQ media queue", () => {
  const queue = new BullMediaQueue(REDIS_URL);
  afterAll(async () => {
    await queue.close();
  });

  it("delivers scan jobs to a worker and de-duplicates per asset", async () => {
    const assetId = randomUUID();
    const seen: string[] = [];
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((r) => (resolveDone = r));
    const worker = new Worker<MediaJob>(
      MEDIA_QUEUE_NAME,
      async (job) => {
        if (job.data.type === "scan" && job.data.assetId === assetId) {
          seen.push(job.data.assetId);
          resolveDone();
        }
      },
      { connection: redisConnection(REDIS_URL) },
    );
    try {
      await queue.enqueueScan(assetId);
      await queue.enqueueScan(assetId); // duplicate (same jobId)
      await done;
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toEqual([assetId]);
    } finally {
      await worker.close();
    }
  });

  it("parses redis URLs including credentials, db and TLS", () => {
    expect(redisConnection("rediss://user:p%40ss@cache.example:6380/2")).toMatchObject({
      host: "cache.example",
      port: 6380,
      username: "user",
      password: "p@ss",
      db: 2,
      tls: {},
    });
  });
});
