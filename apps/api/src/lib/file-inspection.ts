import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { MediaKind } from "@inother/shared";

/** Real file types (detected from bytes) accepted per kind, keyed by detected extension. */
const ALLOWED_DETECTED: Record<MediaKind, ReadonlySet<string>> = {
  image: new Set(["jpg", "png", "webp"]),
  // Audio recorded in browsers often arrives in a WebM/MP4 container.
  audio: new Set(["mp3", "m4a", "mp4", "wav", "ogg", "opus", "oga", "webm"]),
  video: new Set(["mp4", "webm", "mov", "m4v"]),
};

export interface DetectedType {
  ext: string;
  mime: string;
}

/** Inspects the first bytes ("magic numbers"); the declared Content-Type is never trusted. */
export async function detectType(head: Buffer): Promise<DetectedType | null> {
  const t = await fileTypeFromBuffer(head);
  return t ? { ext: t.ext, mime: t.mime } : null;
}

export function isAllowedDetected(kind: MediaKind, detected: DetectedType | null): boolean {
  return detected !== null && ALLOWED_DETECTED[kind].has(detected.ext);
}

const MAX_IMAGE_PIXELS = 50_000_000;

/**
 * Re-encodes an image. This strips ALL metadata (EXIF incl. GPS location, camera serials,
 * embedded thumbnails) and neutralizes polyglot / malformed files: only decoded pixels survive.
 */
export async function sanitizeImage(input: Buffer, ext: string): Promise<{ data: Buffer; mime: string }> {
  const img = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).rotate();
  switch (ext) {
    case "png":
      return { data: await img.png({ compressionLevel: 9 }).toBuffer(), mime: "image/png" };
    case "webp":
      return { data: await img.webp({ quality: 90 }).toBuffer(), mime: "image/webp" };
    default:
      return { data: await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer(), mime: "image/jpeg" };
  }
}
