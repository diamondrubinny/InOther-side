import type { DbExecutor } from "../db/client.js";
import { auditLog } from "../db/schema.js";

export type AuditAction =
  | "auth.register"
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.login.locked"
  | "auth.logout"
  | "auth.logout_all"
  | "auth.email_verified"
  | "auth.password_reset.requested"
  | "auth.password_reset.completed"
  | "auth.password_changed"
  | "auth.reauth"
  | "auth.mfa.enabled"
  | "auth.mfa.disabled"
  | "auth.mfa.recovery_code_used"
  | "account.deleted"
  | "account.exported"
  | "consent.granted"
  | "consent.withdrawn"
  | "vault.created"
  | "vault.updated"
  | "vault.deleted"
  | "vault.exported"
  | "vault.beneficiary.created"
  | "vault.beneficiary.updated"
  | "vault.beneficiary.deleted"
  | "vault.executor.created"
  | "vault.executor.updated"
  | "vault.executor.deleted"
  | "vault.story.created"
  | "vault.story.updated"
  | "vault.story.deleted"
  | "vault.answer.saved"
  | "vault.answer.deleted"
  | "media.created"
  | "media.uploaded"
  | "media.updated"
  | "media.deleted"
  | "media.clean"
  | "media.rejected"
  | "media.infected"
  | "media.scan_failed"
  | "account.profile_updated"
  | "invitation.sent"
  | "invitation.accepted"
  | "release.reported"
  | "release.document_uploaded"
  | "release.document_infected"
  | "release.document_viewed"
  | "release.approved"
  | "release.rejected"
  | "release.second_confirmed"
  | "release.cancelled"
  | "release.completed"
  | "inheritance.viewed"
  | "persona.session_started"
  | "persona.safety_event"
  | "persona.settings_updated"
  | "persona.voice_cloned"
  | "persona.voice_deleted"
  | "persona.profile_generated"
  | "persona.profile_updated"
  | "persona.profile_approved"
  | "persona.feedback"
  | "interview.answer_saved"
  | "interview.answer_deleted";

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  ipHash?: string | null;
  /** Small, non-sensitive metadata only. Never content, emails, names or secrets. */
  metadata?: Record<string, string | number | boolean | null>;
}

export async function writeAudit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    ipHash: entry.ipHash ?? null,
    metadata: entry.metadata ?? null,
  });
}
