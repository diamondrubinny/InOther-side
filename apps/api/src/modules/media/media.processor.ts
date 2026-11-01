import { Readable } from "node:stream";
import { and, eq, inArray, sql } from "drizzle-orm";
import { MAX_MEDIA_BYTES } from "@inother/shared";
import type { AppContext } from "../../context.js";
import { legacyVaults, mediaAssets } from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";
import { createDecryptStream, createEncryptStream } from "../../lib/crypto/stream.js";
import { detectType, isAllowedDetected, sanitizeImage } from "../../lib/file-inspection.js";
import { mediaKeys } from "../../lib/storage.js";
import { mediaAad, readAll } from "./media.service.js";

/** After this many failed scan attempts the file stays quarantined with status scan_failed. */
export const MAX_SCAN_ATTEMPTS = 5;
const SNIFF_BYTES = 4100;

export type ProcessOutcome = "clean" | "rejected" | "infected" | "skipped";

/** Thrown when scanning could not complete; the job should be retried later. */
export class RetryableScanError extends Error {}

/**
 * Background pipeline for an uploaded file (runs in the worker process):
 *   1. verify the real file type from its bytes (magic numbers),
 *   2. scan for malware with ClamAV (fail closed: no scan → never served),
 *   3. images: re-encode to strip metadata (GPS etc.) and neutralize malformed files,
 *   4. re-encrypt into permanent storage and delete the quarantine copy.
 */
export class MediaProcessor {
  constructor(private readonly ctx: AppContext) {}

  async process(assetId: string): Promise<ProcessOutcome> {
    // Claim the asset; also re-claims "scanning" after a worker crash.
    const [asset] = await this.ctx.db
      .update(mediaAssets)
      .set({ status: "scanning", scanAttempts: sql`${mediaAssets.scanAttempts} + 1`, updatedAt: this.ctx.now() })
      .where(and(eq(mediaAssets.id, assetId), inArray(mediaAssets.status, ["quarantined", "scanning"])))
      .returning();
    if (!asset) return "skipped";

    const [vault] = await this.ctx.db
      .select({ id: legacyVaults.id, wrappedDek: legacyVaults.wrappedDek, kekId: legacyVaults.kekId })
      .from(legacyVaults)
      .where(eq(legacyVaults.id, asset.vaultId));
    if (!vault) return "skipped";
    const dek = await this.ctx.keys.unwrapKey(vault.wrappedDek, vault.kekId, `vault:${vault.id}`);
    const quarantineKey = mediaKeys.quarantine(vault.id, asset.id);
    const contentKey = mediaKeys.content(vault.id, asset.id);
    const openQuarantine = async () => {
      const src = await this.ctx.storage.get(quarantineKey);
      const dec = createDecryptStream(dek, mediaAad.quarantine(asset.id));
      src.on("error", (e) => dec.destroy(e));
      return src.pipe(dec);
    };

    // 1. Real type.
    const head = await readHead(await openQuarantine(), SNIFF_BYTES);
    const detected = await detectType(head);
    if (!isAllowedDetected(asset.kind, detected)) {
      return this.finishBad(asset.id, quarantineKey, "rejected", "file_type_not_allowed", { detected: detected?.ext ?? "unknown" });
    }

    // 2. Malware scan (fail closed).
    let result;
    try {
      result = await this.ctx.scanner.scan(await openQuarantine());
    } catch (err) {
      const attempts = asset.scanAttempts;
      const exhausted = attempts >= MAX_SCAN_ATTEMPTS;
      await this.ctx.db
        .update(mediaAssets)
        .set({ status: exhausted ? "scan_failed" : "quarantined", statusReason: exhausted ? "scanner_unavailable" : null, updatedAt: this.ctx.now() })
        .where(eq(mediaAssets.id, asset.id));
      this.ctx.log.error({ err, assetId: asset.id, attempts }, "malware scan failed");
      if (exhausted) {
        await writeAudit(this.ctx.db, { actorId: null, action: "media.scan_failed", targetType: "media", targetId: asset.id });
        return "skipped";
      }
      throw new RetryableScanError("scan failed; will retry");
    }
    if (!result.clean) {
      this.ctx.log.warn({ assetId: asset.id, signature: result.signature }, "malware detected in upload");
      return this.finishBad(asset.id, quarantineKey, "infected", "malware_detected", { signature: result.signature });
    }

    // 3 + 4. Sanitize (images) and move to permanent encrypted storage.
    let size: number;
    let mime = detected?.mime ?? asset.declaredMime;
    if (asset.kind === "image") {
      let clean;
      try {
        const original = await readAll(await openQuarantine());
        if (original.length > MAX_MEDIA_BYTES.image) throw new Error("too large");
        clean = await sanitizeImage(original, detected?.ext ?? "jpg");
      } catch {
        return this.finishBad(asset.id, quarantineKey, "rejected", "image_unreadable", {});
      }
      size = clean.data.length;
      mime = clean.mime;
      await this.ctx.storage.put(contentKey, Readable.from([clean.data]).pipe(createEncryptStream(dek, mediaAad.content(asset.id))));
    } else {
      // NOTE: audio/video container metadata (e.g. GPS in MP4) is not stripped yet; planned with a sandboxed ffmpeg step.
      const plain = await openQuarantine();
      const enc = createEncryptStream(dek, mediaAad.content(asset.id));
      plain.on("error", (e) => enc.destroy(e));
      await this.ctx.storage.put(contentKey, plain.pipe(enc));
      size = asset.sizeBytes ?? asset.declaredSize;
    }

    const updated = await this.ctx.db
      .update(mediaAssets)
      .set({ status: "clean", statusReason: null, detectedMime: mime, sizeBytes: size, scannedAt: this.ctx.now(), updatedAt: this.ctx.now() })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.status, "scanning")))
      .returning({ id: mediaAssets.id });
    await this.ctx.storage.delete(quarantineKey);
    if (updated.length === 0) {
      // Deleted by the user while we were processing: don't leave an orphan object.
      await this.ctx.storage.delete(contentKey);
      return "skipped";
    }
    await writeAudit(this.ctx.db, { actorId: null, action: "media.clean", targetType: "media", targetId: asset.id, metadata: { scanner: this.ctx.scanner.name } });
    // Recordings go on to transcription (consent is checked by the transcription job itself).
    if ((asset.kind === "audio" || asset.kind === "video") && this.ctx.transcriber) {
      await this.ctx.mediaQueue.enqueueTranscribe(asset.id).catch((err: unknown) => this.ctx.log.error({ err }, "failed to enqueue transcription"));
    }
    return "clean";
  }

  private async finishBad(
    assetId: string,
    quarantineKey: string,
    status: "rejected" | "infected",
    reason: string,
    metadata: Record<string, string>,
  ): Promise<ProcessOutcome> {
    await this.ctx.db
      .update(mediaAssets)
      .set({ status, statusReason: reason, scannedAt: this.ctx.now(), updatedAt: this.ctx.now() })
      .where(eq(mediaAssets.id, assetId));
    await this.ctx.storage.delete(quarantineKey);
    await writeAudit(this.ctx.db, {
      actorId: null,
      action: status === "infected" ? "media.infected" : "media.rejected",
      targetType: "media",
      targetId: assetId,
      metadata: { reason, ...metadata },
    });
    return status;
  }
}

async function readHead(stream: Readable, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
    total += (chunk as Buffer).length;
    if (total >= bytes) break; // breaking the loop destroys the stream
  }
  return Buffer.concat(chunks).subarray(0, bytes);
}
