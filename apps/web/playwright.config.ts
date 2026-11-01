import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

/**
 * End-to-end tests: real API + media worker + Next.js production build + Chromium.
 * Requires PostgreSQL (database inother_e2e) and Redis, like the API integration tests.
 */
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://inother:inother_dev@localhost:5432/inother_e2e";
const apiEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "warn",
  PORT: "4100",
  DATABASE_URL: E2E_DB,
  WEB_ORIGIN: "http://localhost:3100",
  MASTER_KEY_BASE64: randomBytes(32).toString("base64"),
  HMAC_SECRET_BASE64: randomBytes(32).toString("base64"),
  MAIL_TRANSPORT: "memory",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "/tmp/inother-e2e-storage",
  SCANNER: "noop",
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379/13",
  RATE_LIMIT_GLOBAL_PER_MINUTE: "5000",
  // All E2E browsers share one IP; production refuses any value other than 1.
  AUTH_RATE_LIMIT_MULTIPLIER: "20",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    locale: "he-IL",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node ../api/dist/db/migrate.js && node ../api/dist/server.js",
      url: "http://localhost:4100/health",
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "node ../api/dist/worker.js",
      env: { ...apiEnv, LOG_LEVEL: "info" },
      reuseExistingServer: false,
      // The worker has no HTTP port; Playwright just keeps it running.
      wait: { stdout: /media worker started/ },
      timeout: 30_000,
    },
    {
      // NEXT_PUBLIC_* values are inlined at build time, so the E2E build must use the E2E API URL.
      command: "npx next build && npx next start --port 3100",
      url: "http://localhost:3100/he",
      env: { NEXT_PUBLIC_API_URL: "http://localhost:4100", NEXT_PUBLIC_SITE_URL: "http://localhost:3100", NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});

export { E2E_DB };
