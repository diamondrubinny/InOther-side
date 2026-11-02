import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { captureLinks, invitations, oneTimeTokens, sessions, users } from "../src/db/schema.js";
import { RETENTION_DAYS, RetentionService } from "../src/modules/ops/retention.service.js";
import { STRONG_PASSWORD, createHarness, registerBody, nextIp, signUpAndLogin, type Harness } from "./harness.js";
import { testDatabaseUrl, testEnv } from "./env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appPassword = randomBytes(18).toString("base64url");
const appUrl = () => {
  const u = new URL(testDatabaseUrl());
  u.username = "inother_app";
  u.password = appPassword;
  return u.toString();
};

/** Applies infra/db-roles.sql as the owner (psql variables substituted the way psql would). */
async function applyRoles(): Promise<void> {
  const script = (await readFile(path.join(here, "../../../infra/db-roles.sql"), "utf8"))
    .replace(/^\\set .*$/m, "")
    .replace(":'app_password'", `'${appPassword}'`);
  const owner = postgres(testDatabaseUrl(), { onnotice: () => {} });
  try {
    await owner.unsafe(script);
  } finally {
    await owner.end();
  }
}

describe("least-privilege database role (infra/db-roles.sql)", () => {
  let app: postgres.Sql;
  beforeAll(async () => {
    await applyRoles();
    app = postgres(appUrl(), { onnotice: () => {}, max: 1 });
  });
  afterAll(async () => {
    await app.end();
  });

  const denied = async (q: Promise<unknown>) => {
    await expect(q).rejects.toThrow(/permission denied|must be owner/);
  };

  it("cannot change the schema, truncate, rewrite the audit log, or read the migrations journal", async () => {
    await denied(app.unsafe("DROP TABLE users CASCADE"));
    await denied(app.unsafe("TRUNCATE users CASCADE"));
    await denied(app.unsafe("CREATE TABLE evil (id int)"));
    await denied(app.unsafe("ALTER TABLE users ADD COLUMN evil text"));
    await denied(app.unsafe("UPDATE audit_log SET action = 'x'"));
    await denied(app.unsafe("DELETE FROM audit_log"));
    await denied(app.unsafe('SELECT * FROM drizzle."__drizzle_migrations"'));
    // ...but may append to it.
    await app.unsafe("INSERT INTO audit_log (action) VALUES ('test.role_check')");
  });

  it("re-running the script is safe", async () => {
    await applyRoles();
  });
});

describe("the whole app runs as the least-privilege role", () => {
  let h: Harness;
  beforeAll(async () => {
    await applyRoles();
    h = await createHarness({ DATABASE_URL: appUrl() }, { appDatabaseUrl: appUrl() });
  });
  afterAll(async () => {
    await h?.close();
  });

  it("sign-up, vault, people, stories, media, export and account deletion", async () => {
    const cookie = await signUpAndLogin(h, "role-user@example.com");
    const req = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });
    expect((await req("POST", "/vault", { consentToProcessing: true })).statusCode).toBe(201);
    expect((await req("POST", "/vault/beneficiaries", { name: "A", relation: "child", email: "a@example.com", birthDate: "2001-01-01" })).statusCode).toBe(201);
    expect((await req("POST", "/vault/stories", { title: "t", body: "b", audience: "all", releaseRule: "on_release", delivery: "original_only" })).statusCode).toBe(201);
    expect((await req("PUT", "/vault/answers/childhood.home", { text: "x" })).statusCode).toBe(200);
    const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2400, 1)]);
    const created = (await req("POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: mp3.length })).json();
    const up = await h.request({ method: "PUT", url: created.uploadUrl, cookie, rawBody: mp3, headers: { "content-type": "audio/mpeg" }, ip: nextIp() });
    expect(up.statusCode).toBe(202);
    expect((await req("POST", "/vault/capture-links", { source: "catalog" })).statusCode).toBe(201);
    await req("POST", "/auth/reauth", { password: STRONG_PASSWORD });
    expect((await req("GET", "/vault/export")).statusCode).toBe(200);
    expect((await req("DELETE", "/me")).statusCode).toBe(204);
    expect(await h.db.db.select().from(users).where(eq(users.email, "role-user@example.com"))).toHaveLength(0);
  });

  it("readiness reports the database", async () => {
    const res = await h.request({ method: "GET", url: "/ready" });
    expect(res.json()).toEqual({ status: "ready", checks: { db: "ok" } });
  });
});

describe("rate limits are shared across instances (RATE_LIMIT_STORE=redis)", () => {
  it("two API instances count login attempts together", async () => {
    const shared = {
      RATE_LIMIT_STORE: "redis",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15",
      HMAC_SECRET_BASE64: randomBytes(32).toString("base64"),
    };
    const a = await buildApp(testEnv(shared));
    const b = await buildApp(testEnv(shared));
    try {
      const ip = `172.16.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
      const login = (app: typeof a.app) =>
        app.inject({ method: "POST", url: "/auth/login", headers: { origin: "https://app.inother.test" }, remoteAddress: ip, payload: { email: "nobody@example.com", password: "wrong password 123" } });
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) codes.push((await login(a.app)).statusCode);
      for (let i = 0; i < 5; i++) codes.push((await login(b.app)).statusCode);
      expect(codes.slice(0, 10).every((c) => c !== 429)).toBe(true);
      expect(codes[10]).toBe(429); // the 11th attempt overall (limit 10 per 15 min), on the OTHER instance
      expect((await a.app.inject({ method: "GET", url: "/ready" })).json()).toEqual({ status: "ready", checks: { db: "ok", redis: "ok" } });
    } finally {
      await a.app.close();
      await b.app.close();
    }
  });

  it("production refuses the in-memory store", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    expect(() =>
      loadEnv({ ...process.env, NODE_ENV: "production", DATABASE_URL: testDatabaseUrl(), WEB_ORIGIN: "https://x.example", MASTER_KEY_BASE64: randomBytes(32).toString("base64"), HMAC_SECRET_BASE64: randomBytes(32).toString("base64"), RATE_LIMIT_STORE: "memory" }),
    ).toThrow(/RATE_LIMIT_STORE/);
  });
});

describe("retention policy", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("purges only what has outlived its retention period", async () => {
    const DAY = 86_400_000;
    await signUpAndLogin(h, "keeper@example.com"); // verified, with a live session
    // An unverified account, a month old, without a vault.
    await h.request({ method: "POST", url: "/auth/register", body: registerBody("ghost@example.com"), ip: nextIp() });
    const db = h.db.db;
    const [ghost] = await db.select().from(users).where(eq(users.email, "ghost@example.com"));
    expect(ghost).toBeDefined();
    const svc = new RetentionService(h.ctx);
    expect(await svc.run()).toMatchObject({ unverifiedAccounts: 0, sessions: 0 });

    h.clock.now = new Date(h.clock.now.getTime() + (RETENTION_DAYS.unverifiedAccounts + 2) * DAY);
    const result = await svc.run();
    expect(result.unverifiedAccounts).toBe(1);
    expect(result.sessions).toBeGreaterThanOrEqual(1); // keeper's session went idle long ago
    expect(result.oneTimeTokens).toBeGreaterThanOrEqual(1); // verification tokens
    expect(await db.select().from(users).where(eq(users.email, "keeper@example.com"))).toHaveLength(1); // verified: kept
    expect(await db.select().from(users).where(eq(users.email, "ghost@example.com"))).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(oneTimeTokens)).toHaveLength(0);
    expect(await db.select().from(invitations)).toHaveLength(0);
    expect(await db.select().from(captureLinks)).toHaveLength(0);
    // Idempotent.
    expect(Object.values(await svc.run()).every((n) => n === 0)).toBe(true);
  });
});
