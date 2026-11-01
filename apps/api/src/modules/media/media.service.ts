import { randomUUID } from "node:crypto";
import { Transform, type Readable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, count, eq, inArray, lt, notInArray, sql, sum } from "drizzle-orm";
import type { CreateMediaInput, UpdateMediaInput } from "@inother/shared";
import type { AppContext } from "../../context.js";
import { mediaAssets, mediaTranscripts, sealedStories } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import type { VaultCipher } from "../../lib/crypto/keys.js";
import { createDecryptStream, createEncryptStream } from "../../lib/crypto/stream.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { mediaKeys } from "../../lib/storage.js";
import type { VaultService } from "../vault/vault.service.js";

type MediaRow = typeof mediaAssets.$inferSelect;

/** Max files that may be "awaiting upload" at once per vault (limits abandoned reservations). */
const MAX_PENDING_UPLOADS = 10;
/** Reservations not uploaded within this window are cleaned up. */
export const PENDING_UPLOAD_TTL_HOURS = 24;

export const mediaAad = {
  label: (id: string) => `media.label:${id}`,
  quarantine: (id: string) => `media.quarantine:${id}`,
  content: (id: string) => `media.content:${id}`,
};

/** Counts bytes and aborts the stream as soon as it exceeds the allowed size. */
export class ByteLimit extends Transform {
  bytes = 0;
  constructor(private readonly limit: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) return cb(new AppError(413, "payload_too_large"));
    cb(null, chunk);
  }
}

export class MediaService {
  constructor(
    private readonly ctx: AppContext,
    private readonly vaults: VaultService,
  ) {}

  present(r: MediaRow, cipher: VaultCipher) {
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      statusReason: r.statusReason,
      contentType: r.status === "clean" ? (r.detectedMime ?? r.declaredMime) : r.declaredMime,
      sizeBytes: r.sizeBytes ?? r.declaredSize,
      label: r.labelEnc ? cipher.decrypt(r.labelEnc, mediaAad.label(r.id)) : null,
      storyId: r.storyId,
      createdAt: r.createdAt,
      scannedAt: r.scannedAt,
    };
  }

  private async assertStoryInVault(vaultId: string, storyId: string | null | undefined): Promise<void> {
    if (!storyId) return;
    const [s] = await this.ctx.db
      .select({ id: sealedStories.id })
      .from(sealedStories)
      .where(and(eq(sealedStories.id, storyId), eq(sealedStories.vaultId, vaultId)));
    if (!s) throw badRequest("unknown_story");
  }

  /** Step 1: reserve an upload slot after checking type, size and quota. */
  async create(userId: string, input: CreateMediaInput, ipHash: string | null) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    await this.assertStoryInVault(vault.id, input.storyId);

    const [usage] = await this.ctx.db
      .select({
        files: count(),
        bytes: sum(sql`coalesce(${mediaAssets.sizeBytes}, ${mediaAssets.declaredSize})`).mapWith(Number),
        pending: sql<number>`count(*) filter (where ${mediaAssets.status} in ('awaiting_upload', 'uploading'))`.mapWith(Number),
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.vaultId, vault.id), notInArray(mediaAssets.status, ["rejected", "infected"])));
    if ((usage?.files ?? 0) >= this.ctx.env.MEDIA_MAX_FILES) throw conflict("limit_reached");
    if ((usage?.bytes ?? 0) + input.sizeBytes > this.ctx.env.MEDIA_QUOTA_BYTES) throw conflict("quota_exceeded");
    if ((usage?.pending ?? 0) >= MAX_PENDING_UPLOADS) throw conflict("too_many_pending_uploads");

    const id = randomUUID();
    const [row] = await this.ctx.db
      .insert(mediaAssets)
      .values({
        id,
        vaultId: vault.id,
        storyId: input.storyId ?? null,
        kind: input.kind,
        declaredMime: input.contentType,
        declaredSize: input.sizeBytes,
        labelEnc: input.label ? cipher.encrypt(input.label, mediaAad.label(id)) : null,
      })
      .returning();
    await writeAudit(this.ctx.db, {
      actorId: userId,
      action: "media.created",
      targetType: "media",
      targetId: id,
      ipHash,
      metadata: { kind: input.kind, sizeBytes: input.sizeBytes },
    });
    return this.present(row as MediaRow, cipher);
  }

  /**
   * Step 2: receive the bytes. They are encrypted on the fly and land in quarantine;
   * nothing is readable by anyone until the background processor verifies and scans them.
   */
  async upload(
    userId: string,
    id: string,
    body: Readable,
    contentType: string | undefined,
    contentLength: number | undefined,
    ipHash: string | null,
  ) {
    const { vault } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const [asset] = await this.ctx.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.vaultId, vault.id)));
    if (!asset) throw notFound();
    if ((contentType ?? "").split(";")[0]?.trim().toLowerCase() !== asset.declaredMime) {
      throw new AppError(415, "content_type_mismatch");
    }
    if (contentLength === undefined || contentLength !== asset.declaredSize) {
      throw badRequest("content_length_mismatch");
    }

    // Atomically claim the slot so concurrent uploads for the same asset cannot interleave.
    const claimed = await this.ctx.db
      .update(mediaAssets)
      .set({ status: "uploading", updatedAt: this.ctx.now() })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.status, "awaiting_upload")))
      .returning({ id: mediaAssets.id });
    if (claimed.length === 0) throw conflict("upload_not_allowed");

    const key = mediaKeys.quarantine(vault.id, id);
    const dek = await this.vaults.dekFor(vault);
    const limiter = new ByteLimit(asset.declaredSize);
    try {
      const encrypted = body.pipe(limiter).pipe(createEncryptStream(dek, mediaAad.quarantine(id)));
      limiter.on("error", (err) => encrypted.destroy(err));
      body.on("error", (err) => limiter.destroy(err));
      await this.ctx.storage.put(key, encrypted);
      if (limiter.bytes !== asset.declaredSize) throw badRequest("content_length_mismatch");
    } catch (err) {
      await this.ctx.storage.delete(key).catch(() => {});
      await this.ctx.db
        .update(mediaAssets)
        .set({ status: "awaiting_upload", updatedAt: this.ctx.now() })
        .where(eq(mediaAssets.id, id));
      throw err;
    }

    await this.ctx.db
      .update(mediaAssets)
      .set({ status: "quarantined", sizeBytes: limiter.bytes, updatedAt: this.ctx.now() })
      .where(eq(mediaAssets.id, id));
    await writeAudit(this.ctx.db, { actorId: userId, action: "media.uploaded", targetType: "media", targetId: id, ipHash });
    await this.ctx.mediaQueue.enqueueScan(id);
    return this.get(userId, id);
  }

  async list(userId: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const rows = await this.ctx.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.vaultId, vault.id))
      .orderBy(asc(mediaAssets.createdAt));
    const transcripts = new Map(
      (await this.ctx.db.select({ id: mediaTranscripts.mediaId, status: mediaTranscripts.status }).from(mediaTranscripts).where(eq(mediaTranscripts.vaultId, vault.id))).map((t) => [t.id, t.status]),
    );
    return rows.map((r) => ({ ...this.present(r, cipher), transcriptStatus: transcripts.get(r.id) ?? "none" }));
  }

  async get(userId: string, id: string) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    const [row] = await this.ctx.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.vaultId, vault.id)));
    if (!row) throw notFound();
    return this.present(row, cipher);
  }

  async update(userId: string, id: string, input: UpdateMediaInput, ipHash: string | null) {
    const { vault, cipher } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    await this.assertStoryInVault(vault.id, input.storyId);
    const set: Partial<typeof mediaAssets.$inferInsert> = { updatedAt: this.ctx.now() };
    if (input.label !== undefined) set.labelEnc = input.label === null ? null : cipher.encrypt(input.label, mediaAad.label(id));
    if (input.storyId !== undefined) set.storyId = input.storyId;
    const [row] = await this.ctx.db
      .update(mediaAssets)
      .set(set)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.vaultId, vault.id)))
      .returning();
    if (!row) throw notFound();
    await writeAudit(this.ctx.db, { actorId: userId, action: "media.updated", targetType: "media", targetId: id, ipHash });
    return this.present(row, cipher);
  }

  async delete(userId: string, id: string, ipHash: string | null): Promise<void> {
    const { vault } = await this.vaults.getOwned(userId);
    this.vaults.assertEditable(vault);
    const deleted = await this.ctx.db
      .delete(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.vaultId, vault.id)))
      .returning({ id: mediaAssets.id });
    if (deleted.length === 0) throw notFound();
    await Promise.all([
      this.ctx.storage.delete(mediaKeys.quarantine(vault.id, id)),
      this.ctx.storage.delete(mediaKeys.content(vault.id, id)),
    ]);
    await writeAudit(this.ctx.db, { actorId: userId, action: "media.deleted", targetType: "media", targetId: id, ipHash });
  }

  /** Decrypted content of a verified, clean file. Quarantined or rejected files are never served. */
  async content(userId: string, id: string): Promise<{ stream: Readable; mime: string; size: number; kind: MediaRow["kind"] }> {
    const { vault } = await this.vaults.getOwned(userId);
    const [row] = await this.ctx.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.vaultId, vault.id)));
    if (!row) throw notFound();
    if (row.status !== "clean") throw conflict("media_not_ready");
    const dek = await this.vaults.dekFor(vault);
    const source = await this.ctx.storage.get(mediaKeys.content(vault.id, id));
    const decrypt = createDecryptStream(dek, mediaAad.content(id));
    source.on("error", (err) => decrypt.destroy(err));
    return {
      stream: source.pipe(decrypt),
      mime: row.detectedMime ?? row.declaredMime,
      size: row.sizeBytes ?? 0,
      kind: row.kind,
    };
  }

  /** Removes reservations that were never uploaded (and any partial quarantine object). */
  async cleanupStalePending(): Promise<number> {
    const cutoff = new Date(this.ctx.now().getTime() - PENDING_UPLOAD_TTL_HOURS * 3600_000);
    const stale = await this.ctx.db
      .delete(mediaAssets)
      .where(and(inArray(mediaAssets.status, ["awaiting_upload", "uploading"]), lt(mediaAssets.updatedAt, cutoff)))
      .returning({ id: mediaAssets.id, vaultId: mediaAssets.vaultId });
    await Promise.all(stale.map((s) => this.ctx.storage.delete(mediaKeys.quarantine(s.vaultId, s.id)).catch(() => {})));
    return stale.length;
  }
}

/** Utility for tests and tools: fully drain a readable into a buffer. */
export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(stream, async function* (src) {
    for await (const c of src) chunks.push(c as Buffer);
  });
  return Buffer.concat(chunks);
}
