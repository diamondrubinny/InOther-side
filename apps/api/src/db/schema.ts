import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Binary column (encrypted payloads, hashes). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// Identity & sessions
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["user", "staff"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Normalized (trimmed, lower-cased) email. */
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("he"),
    adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }).notNull(),
    /** TOTP secret encrypted with the master key (never stored in plain text). */
    totpSecretEnc: bytea("totp_secret_enc"),
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
    /** "staff" may review death certificates. Granted manually (never via the API). */
    role: userRoleEnum("role").notNull().default("user"),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque session token; the token itself is only in the user's cookie. */
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reauthAt: timestamp("reauth_at", { withTimezone: true }).notNull().defaultNow(),
    /** Truncated / hashed metadata only (no raw IP). */
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const tokenPurposeEnum = pgEnum("token_purpose", ["email_verify", "password_reset", "mfa_challenge"]);

/** Single-use, short-lived tokens. Only hashes are stored. */
export const oneTimeTokens = pgTable(
  "one_time_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: tokenPurposeEnum("purpose").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ott_token_hash_uq").on(t.tokenHash), index("ott_user_purpose_idx").on(t.userId, t.purpose)],
);

export const recoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: bytea("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recovery_user_idx").on(t.userId)],
);

/** Last accepted TOTP time-step per user, to prevent code replay within its validity window. */
export const totpUsage = pgTable("mfa_totp_usage", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastCounter: integer("last_counter").notNull(),
});

// ---------------------------------------------------------------------------
// Consents & audit
// ---------------------------------------------------------------------------

export const consentPurposeEnum = pgEnum("consent_purpose", [
  "terms_and_privacy",
  "legacy_vault_processing",
  "voice_cloning",
  "avatar_creation",
  "ai_processing",
]);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: consentPurposeEnum("purpose").notNull(),
    policyVersion: text("policy_version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [index("consents_user_idx").on(t.userId, t.purpose)],
);

/**
 * Append-only security audit log. Never store content, secrets or raw PII here.
 * actor_id is intentionally not a foreign key so entries survive account deletion.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_actor_idx").on(t.actorId, t.createdAt), index("audit_target_idx").on(t.targetType, t.targetId)],
);

// ---------------------------------------------------------------------------
// Legacy vault
// ---------------------------------------------------------------------------

export const vaultStatusEnum = pgEnum("vault_status", [
  "building",
  "release_pending",
  "released",
  "never_release",
]);

export const legacyVaults = pgTable(
  "legacy_vaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legatorUserId: uuid("legator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: vaultStatusEnum("status").notNull().default("building"),
    releaseWaitDays: integer("release_wait_days").notNull().default(14),
    requireSecondExecutor: boolean("require_second_executor").notNull().default(true),
    /** Per-vault data-encryption key, wrapped (encrypted) by the master key. Deleting it crypto-shreds the vault. */
    wrappedDek: bytea("wrapped_dek").notNull(),
    kekId: text("kek_id").notNull(),
    openingMessageEnc: bytea("opening_message_enc"),
    ...timestamps,
  },
  // One vault per legator for now.
  (t) => [uniqueIndex("vault_legator_uq").on(t.legatorUserId)],
);

export const relationEnum = pgEnum("relation", [
  "spouse",
  "partner",
  "child",
  "grandchild",
  "parent",
  "sibling",
  "relative",
  "friend",
  "other",
]);

export const beneficiaryStatusEnum = pgEnum("beneficiary_status", ["designated", "invited", "accepted", "declined"]);

export const vaultBeneficiaries = pgTable(
  "vault_beneficiaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    nameEnc: bytea("name_enc").notNull(),
    emailEnc: bytea("email_enc").notNull(),
    relation: relationEnum("relation").notNull(),
    notifyBeforeDeath: boolean("notify_before_death").notNull().default(false),
    status: beneficiaryStatusEnum("status").notNull().default("designated"),
    /** Linked account once the beneficiary accepts an invitation (email must match). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("beneficiaries_vault_idx").on(t.vaultId)],
);

export const executorStatusEnum = pgEnum("executor_status", ["designated", "invited", "confirmed", "removed"]);

export const vaultExecutors = pgTable(
  "vault_executors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    nameEnc: bytea("name_enc").notNull(),
    emailEnc: bytea("email_enc").notNull(),
    relation: relationEnum("relation").notNull(),
    status: executorStatusEnum("status").notNull().default("designated"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("executors_vault_idx").on(t.vaultId)],
);

export const storyAudienceEnum = pgEnum("story_audience", ["all", "specific"]);
export const storyReleaseRuleEnum = pgEnum("story_release_rule", ["on_release", "date", "on_topic"]);
export const storyDeliveryEnum = pgEnum("story_delivery", ["persona_tells", "original_only"]);

export const sealedStories = pgTable(
  "sealed_stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    titleEnc: bytea("title_enc").notNull(),
    bodyEnc: bytea("body_enc").notNull(),
    audience: storyAudienceEnum("audience").notNull(),
    releaseRule: storyReleaseRuleEnum("release_rule").notNull(),
    releaseAt: date("release_at"),
    topicEnc: bytea("topic_enc"),
    delivery: storyDeliveryEnum("delivery").notNull(),
    sensitivityAck: boolean("sensitivity_ack").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("stories_vault_idx").on(t.vaultId)],
);

export const storyAudienceMembers = pgTable(
  "sealed_story_audience",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => sealedStories.id, { onDelete: "cascade" }),
    beneficiaryId: uuid("beneficiary_id")
      .notNull()
      .references(() => vaultBeneficiaries.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("story_audience_uq").on(t.storyId, t.beneficiaryId)],
);

export const guidedAnswers = pgTable(
  "guided_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    textEnc: bytea("text_enc").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("answers_vault_question_uq").on(t.vaultId, t.questionId)],
);

// ---------------------------------------------------------------------------
// Media (photos, voice and video recordings)
// ---------------------------------------------------------------------------

export const mediaKindEnum = pgEnum("media_kind", ["image", "audio", "video"]);
export const mediaStatusEnum = pgEnum("media_status", [
  "awaiting_upload",
  "uploading",
  "quarantined",
  "scanning",
  "clean",
  "rejected",
  "infected",
  "scan_failed",
]);

/**
 * Files are stored encrypted with the vault key under server-generated keys:
 *   quarantine/<vaultId>/<id>  until scanned and verified,
 *   media/<vaultId>/<id>       once clean.
 * The original file name is never stored.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => sealedStories.id, { onDelete: "set null" }),
    kind: mediaKindEnum("kind").notNull(),
    declaredMime: text("declared_mime").notNull(),
    declaredSize: bigint("declared_size", { mode: "number" }).notNull(),
    /** Set after upload (bytes received) and updated after sanitization. */
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    detectedMime: text("detected_mime"),
    status: mediaStatusEnum("status").notNull().default("awaiting_upload"),
    /** Machine-readable reason for rejected / failed files (never user content). */
    statusReason: text("status_reason"),
    labelEnc: bytea("label_enc"),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("media_vault_idx").on(t.vaultId, t.createdAt), index("media_status_idx").on(t.status, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Invitations & release after death
// ---------------------------------------------------------------------------

export const invitationKindEnum = pgEnum("invitation_kind", ["executor", "beneficiary"]);

/** Email invitations for executors / beneficiaries. Only the token hash is stored. */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    kind: invitationKindEnum("kind").notNull(),
    /** vault_executors.id or vault_beneficiaries.id */
    personId: uuid("person_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invitations_token_uq").on(t.tokenHash), index("invitations_person_idx").on(t.personId)],
);

export const releaseStatusEnum = pgEnum("release_status", [
  "awaiting_document",
  "pending_review",
  "awaiting_second_confirmation",
  "waiting_period",
  "released",
  "rejected",
  "cancelled",
]);

/**
 * A report that the legator has died, filed by a confirmed executor.
 * Flow: awaiting_document -> pending_review (staff) -> [awaiting_second_confirmation]
 *       -> waiting_period (legator can still cancel) -> released.
 */
export const releaseRequests = pgTable(
  "release_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    reportedByExecutorId: uuid("reported_by_executor_id").references(() => vaultExecutors.id, { onDelete: "set null" }),
    status: releaseStatusEnum("status").notNull().default("awaiting_document"),
    dateOfDeath: date("date_of_death").notNull(),
    documentMime: text("document_mime"),
    documentSize: integer("document_size"),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Machine-readable reason only (e.g. document_unreadable); never free text about the person. */
    reviewReason: text("review_reason"),
    secondConfirmedByExecutorId: uuid("second_confirmed_by_executor_id").references(() => vaultExecutors.id, { onDelete: "set null" }),
    waitUntil: timestamp("wait_until", { withTimezone: true }),
    cancelTokenHash: bytea("cancel_token_hash").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("release_vault_idx").on(t.vaultId),
    index("release_status_idx").on(t.status),
    // At most one open request per vault.
    uniqueIndex("release_one_open_per_vault")
      .on(t.vaultId)
      .where(sql`${t.status} in ('awaiting_document', 'pending_review', 'awaiting_second_confirmation', 'waiting_period')`),
  ],
);

// ---------------------------------------------------------------------------
// AI persona
// ---------------------------------------------------------------------------

export const voiceStatusEnum = pgEnum("voice_status", ["none", "processing", "ready", "failed"]);

/** Legator-controlled persona configuration (portrait, mouth anchor, cloned voice). */
export const personaSettings = pgTable("persona_settings", {
  vaultId: uuid("vault_id")
    .primaryKey()
    .references(() => legacyVaults.id, { onDelete: "cascade" }),
  portraitMediaId: uuid("portrait_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  /** Mouth position on the portrait, in per-mille of width/height (0-1000). */
  mouthX: integer("mouth_x").notNull().default(500),
  mouthY: integer("mouth_y").notNull().default(680),
  /** Provider reference of the cloned voice, encrypted with the master key. */
  voiceRefEnc: bytea("voice_ref_enc"),
  voiceStatus: voiceStatusEnum("voice_status").notNull().default("none"),
  sessionsLimit: integer("sessions_limit").notNull().default(8),
  minutesLimit: integer("minutes_limit").notNull().default(30),
  ...timestamps,
});

export const personaModeEnum = pgEnum("persona_mode", ["preview", "beneficiary"]);
export const personaKindEnum = pgEnum("persona_kind", ["regular", "farewell"]);

/** Conversation metadata only. Transcripts are NOT stored (privacy by design). */
export const personaSessions = pgTable(
  "persona_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => legacyVaults.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: personaModeEnum("mode").notNull(),
    kind: personaKindEnum("kind").notNull().default("regular"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    turns: integer("turns").notNull().default(0),
    safetyFlag: boolean("safety_flag").notNull().default(false),
  },
  (t) => [index("persona_sessions_user_idx").on(t.userId, t.vaultId)],
);
