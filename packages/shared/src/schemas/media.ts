import { z } from "zod";

export const MEDIA_KINDS = ["image", "audio", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Allowlist of declared content types per kind. Anything else is rejected before upload.
 * The real type is verified again from the file's bytes after upload.
 * HEIC/HEIF is intentionally excluded for now (needs a separate, sandboxed decoder).
 */
export const ALLOWED_CONTENT_TYPES: Record<MediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/wave", "audio/webm", "audio/ogg"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
};

/** Maximum size per file, in bytes. */
export const MAX_MEDIA_BYTES: Record<MediaKind, number> = {
  image: 25 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
};

export const MEDIA_STATUSES = [
  "awaiting_upload",
  "uploading",
  "quarantined",
  "scanning",
  "clean",
  "rejected",
  "infected",
  "scan_failed",
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const createMediaSchema = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    contentType: z.string().trim().toLowerCase().max(100),
    sizeBytes: z.number().int().positive(),
    /** Optional human label, e.g. "Grandpa singing at the wedding". Stored encrypted. */
    label: z.string().trim().min(1).max(200).optional(),
    storyId: z.uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (!ALLOWED_CONTENT_TYPES[v.kind].includes(v.contentType)) {
      ctx.addIssue({ code: "custom", path: ["contentType"], message: "content_type_not_allowed" });
    }
    if (v.sizeBytes > MAX_MEDIA_BYTES[v.kind]) {
      ctx.addIssue({ code: "custom", path: ["sizeBytes"], message: "file_too_large" });
    }
  });
export type CreateMediaInput = z.infer<typeof createMediaSchema>;

export const updateMediaSchema = z
  .object({
    label: z.string().trim().min(1).max(200).nullable(),
    storyId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: "empty_update" });
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
