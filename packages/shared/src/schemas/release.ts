import { z } from "zod";

export const tokenBodySchema = z.object({ token: z.string().min(20).max(200) });

export const reportDeathSchema = z.object({
  /** ISO date (YYYY-MM-DD). Must not be in the future (checked on the server against its clock). */
  dateOfDeath: z.iso.date(),
});
export type ReportDeathInput = z.infer<typeof reportDeathSchema>;

/** Death certificate upload: small documents only. */
export const RELEASE_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const RELEASE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const REJECT_REASONS = ["document_unreadable", "document_mismatch", "suspected_fraud", "other"] as const;
export const rejectReleaseSchema = z.object({ reason: z.enum(REJECT_REASONS) });

export const RELEASE_STATUSES = [
  "awaiting_document",
  "pending_review",
  "awaiting_second_confirmation",
  "waiting_period",
  "released",
  "rejected",
  "cancelled",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
