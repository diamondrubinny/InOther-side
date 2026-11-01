import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * All configuration comes from environment variables and is validated at startup.
 * The process refuses to start with an invalid or insecure configuration.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    /** Public origin of the web app, e.g. https://app.example.com. Used for CORS, CSRF origin checks and email links. */
    WEB_ORIGIN: z.string().url(),
    /** Set when running behind a reverse proxy / load balancer so client IPs are read correctly. */
    TRUST_PROXY: booleanString.default(false),

    /** Base64-encoded 32-byte key-encryption key (KEK). Use a KMS in production. */
    MASTER_KEY_BASE64: z.string().min(1),
    MASTER_KEY_ID: z.string().min(1).max(64).default("local-v1"),

    /** Secret used for HMAC of lookup values (e.g. login rate-limit keys). Base64, >= 32 bytes. */
    HMAC_SECRET_BASE64: z.string().min(1),

    SESSION_COOKIE_NAME: z.string().default("__Host-inother_sid"),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(60 * 24 * 7).default(60 * 24),
    SESSION_ABSOLUTE_TIMEOUT_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    REAUTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),

    MAIL_TRANSPORT: z.enum(["smtp", "log", "memory"]).default("log"),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("InOther-side <no-reply@localhost>"),

    /** Object storage for media. "local" is for development and tests only. */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./var/storage"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("eu-central-1"),
    /** For S3-compatible providers (e.g. MinIO, Cloudflare R2). Leave empty for AWS. */
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: booleanString.default(false),
    /** Optional KMS key for server-side encryption (in addition to our own encryption). */
    S3_SSE_KMS_KEY_ID: z.string().optional(),

    /** Redis for the media-processing queue (BullMQ). */
    REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

    /** Malware scanner. "noop" marks files clean WITHOUT scanning and is refused in production. */
    SCANNER: z.enum(["clamd", "noop"]).default("clamd"),
    CLAMD_HOST: z.string().default("127.0.0.1"),
    CLAMD_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),

    /** Per-vault media quota. */
    MEDIA_QUOTA_BYTES: z.coerce.number().int().min(1).default(20 * 1024 * 1024 * 1024),
    MEDIA_MAX_FILES: z.coerce.number().int().min(1).default(1000),

    /**
     * AI persona. "mock" is deterministic and offline (dev/tests); "anthropic" calls Claude
     * (credentials via ANTHROPIC_API_KEY or `ant auth login`); "none" disables the persona.
     */
    LLM_PROVIDER: z.enum(["none", "mock", "anthropic"]).default("mock"),
    PERSONA_MODEL: z.string().default("claude-opus-5-5"),
    /** Voice cloning / TTS. Real vendors plug in behind VoiceProvider (verify ToS + DPA first). */
    VOICE_PROVIDER: z.enum(["none", "mock"]).default("mock"),

    /**
     * Speech-to-text for the legator's recordings. Recommended: a SELF-HOSTED Whisper-compatible
     * server (e.g. faster-whisper / whisper.cpp with a Hebrew model) so recordings never leave
     * your infrastructure. "openai_compatible" speaks POST {URL}/v1/audio/transcriptions.
     */
    TRANSCRIBER: z.enum(["none", "mock", "openai_compatible"]).default("mock"),
    TRANSCRIBER_URL: z.string().url().optional(),
    TRANSCRIBER_MODEL: z.string().default("whisper-1"),
    TRANSCRIBER_API_KEY: z.string().optional(),
    TRANSCRIBER_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(600_000),

    /** Multiplies the strict per-IP limits on credential endpoints. Tests only; must be 1 in production. */
    AUTH_RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(1000).default(1),
    RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(10).default(300),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(10 * 1024 * 1024).default(256 * 1024),
  })
  .superRefine((env, ctx) => {
    for (const key of ["MASTER_KEY_BASE64", "HMAC_SECRET_BASE64"] as const) {
      const bytes = Buffer.from(env[key], "base64");
      if (bytes.length < 32) {
        ctx.addIssue({ code: "custom", path: [key], message: "must decode to at least 32 bytes" });
      }
    }
    if (env.NODE_ENV === "production") {
      if (env.MAIL_TRANSPORT !== "smtp" || !env.SMTP_URL) {
        ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "production requires smtp transport and SMTP_URL" });
      }
      if (!env.WEB_ORIGIN.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["WEB_ORIGIN"], message: "production requires an https origin" });
      }
      if (env.STORAGE_DRIVER !== "s3") {
        ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "production requires s3 storage" });
      }
      if (env.SCANNER !== "clamd") {
        ctx.addIssue({ code: "custom", path: ["SCANNER"], message: "production requires the clamd malware scanner" });
      }
      if (env.LLM_PROVIDER === "mock" || env.VOICE_PROVIDER === "mock" || env.TRANSCRIBER === "mock") {
        ctx.addIssue({ code: "custom", path: ["LLM_PROVIDER"], message: "mock AI providers are not allowed in production" });
      }
      if (env.AUTH_RATE_LIMIT_MULTIPLIER !== 1) {
        ctx.addIssue({ code: "custom", path: ["AUTH_RATE_LIMIT_MULTIPLIER"], message: "must be 1 in production" });
      }
      if (!env.SESSION_COOKIE_NAME.startsWith("__Host-")) {
        ctx.addIssue({ code: "custom", path: ["SESSION_COOKIE_NAME"], message: "production requires a __Host- cookie" });
      }
    }
    if (env.TRANSCRIBER === "openai_compatible" && !env.TRANSCRIBER_URL) {
      ctx.addIssue({ code: "custom", path: ["TRANSCRIBER_URL"], message: "required when TRANSCRIBER=openai_compatible" });
    }
    if (env.STORAGE_DRIVER === "s3" && !env.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "required when STORAGE_DRIVER=s3" });
    }
    if (env.MAIL_TRANSPORT === "smtp" && !env.SMTP_URL) {
      ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "required when MAIL_TRANSPORT=smtp" });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Print only keys and messages, never values (they may be secrets).
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
