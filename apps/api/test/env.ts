import { randomBytes } from "node:crypto";
import { loadEnv, type Env } from "../src/config/env.js";

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? "postgres://inother:inother_dev@localhost:5432/inother_test";
}

export const WEB_ORIGIN = "https://app.inother.test";

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_POOL_MAX: "5",
    WEB_ORIGIN,
    MASTER_KEY_BASE64: randomBytes(32).toString("base64"),
    HMAC_SECRET_BASE64: randomBytes(32).toString("base64"),
    MAIL_TRANSPORT: "memory",
    RATE_LIMIT_GLOBAL_PER_MINUTE: "10000",
    SCANNER: "noop",
    ...overrides,
  });
}
