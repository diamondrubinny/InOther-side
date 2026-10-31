import { z } from "zod";
import { localeSchema } from "../i18n.js";

/** Current version of the Terms of Service / Privacy Policy the user must accept. */
export const CURRENT_TERMS_VERSION = "2026-10-draft-1";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "invalid_email" }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: "password_too_short" })
  .max(PASSWORD_MAX_LENGTH, { error: "password_too_long" });

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: "invalid_totp_code" });

/** Recovery codes are 10 chars of base32 grouped as XXXXX-XXXXX. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-7]{5}-?[A-Z2-7]{5}$/, { error: "invalid_recovery_code" });

export const displayNameSchema = z.string().trim().min(1).max(80);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  /** The user confirms they are 18 or older. */
  confirmAdult: z.literal(true, { error: "must_confirm_adult" }),
  acceptTerms: z.literal(true, { error: "must_accept_terms" }),
  termsVersion: z.literal(CURRENT_TERMS_VERSION, { error: "outdated_terms_version" }),
  /** Preferred language for emails and content. Defaults to the negotiated request locale. */
  locale: localeSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Second step of login when MFA is enabled. */
export const loginMfaSchema = z
  .object({
    challengeToken: z.string().min(20).max(200),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    error: "provide_code_or_recovery_code",
  });
export type LoginMfaInput = z.infer<typeof loginMfaSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const passwordResetRequestSchema = z.object({ email: emailSchema });

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

export const reauthSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema.optional(),
});

export const mfaConfirmSchema = z.object({ code: totpCodeSchema });

export const mfaDisableSchema = z.object({ code: totpCodeSchema });

export const updateProfileSchema = z
  .object({ displayName: displayNameSchema, locale: localeSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: "empty_update" });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
