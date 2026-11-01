import { Queue } from "bullmq";

export const MEDIA_QUEUE_NAME = "media";

export type MediaJob =
  | { type: "scan"; assetId: string }
  | { type: "transcribe"; assetId: string }
  | { type: "cleanup" }
  | { type: "finalize_releases" };

/** Abstraction over the job queue so request handlers don't depend on BullMQ directly. */
export interface MediaQueue {
  enqueueScan(assetId: string): Promise<void>;
  enqueueTranscribe(assetId: string): Promise<void>;
  close(): Promise<void>;
}

/** Parses a redis:// or rediss:// URL into BullMQ connection options. */
export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export class BullMediaQueue implements MediaQueue {
  private readonly queue: Queue<MediaJob>;
  constructor(redisUrl: string) {
    this.queue = new Queue<MediaJob>(MEDIA_QUEUE_NAME, {
      connection: redisConnection(redisUrl),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  async enqueueScan(assetId: string): Promise<void> {
    // jobId de-duplicates repeated "complete" calls for the same asset.
    await this.queue.add("scan", { type: "scan", assetId }, { jobId: `scan-${assetId}` });
  }

  async enqueueTranscribe(assetId: string): Promise<void> {
    await this.queue.add("transcribe", { type: "transcribe", assetId }, { jobId: `transcribe-${assetId}-${Date.now()}`, attempts: 3 });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/** Tests: runs the processor inline (or records jobs for manual processing). */
export class InlineMediaQueue implements MediaQueue {
  readonly enqueued: string[] = [];
  readonly transcribeQueued: string[] = [];
  onTranscribe?: (assetId: string) => Promise<void>;
  constructor(private readonly onScan?: (assetId: string) => Promise<void>) {}
  async enqueueTranscribe(assetId: string): Promise<void> {
    this.transcribeQueued.push(assetId);
    if (this.onTranscribe) await this.onTranscribe(assetId);
  }
  async enqueueScan(assetId: string): Promise<void> {
    this.enqueued.push(assetId);
    if (this.onScan) await this.onScan(assetId);
  }
  async close(): Promise<void> {}
}
