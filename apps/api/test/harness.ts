import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { CURRENT_TERMS_VERSION } from "@inother/shared";
import { buildApp } from "../src/app.js";
import type { AppContext } from "../src/context.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { testDatabaseUrl, testEnv, WEB_ORIGIN } from "./env.js";

export const STRONG_PASSWORD = "a-very-long passphrase 42";

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  mailer: MemoryMailer;
  db: DbHandle;
  clock: { now: Date; advanceMinutes(m: number): void };
  request(opts: RequestOpts): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export interface RequestOpts {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  cookie?: string;
  /** Override or remove (null) the Origin header. */
  origin?: string | null;
  ip?: string;
}

let ipCounter = 1;
/** Each simulated client gets its own IP so per-IP rate limits don't interfere between tests. */
export function nextIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export async function createHarness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const env = testEnv(envOverrides);
  const db = createDb(testDatabaseUrl(), 5);
  await db.db.execute(
    sql`TRUNCATE users, sessions, one_time_tokens, mfa_recovery_codes, mfa_totp_usage, consents, audit_log,
        legacy_vaults, vault_beneficiaries, vault_executors, sealed_stories, sealed_story_audience, guided_answers CASCADE`,
  );
  const mailer = new MemoryMailer();
  const clock = {
    now: new Date(),
    advanceMinutes(m: number) {
      this.now = new Date(this.now.getTime() + m * 60_000);
    },
  };
  const { app, ctx } = await buildApp(env, { mailer, dbHandle: db, now: () => clock.now });
  await app.ready();

  const request = (opts: RequestOpts) => {
    const headers: Record<string, string> = {};
    if (opts.origin !== null) headers.origin = opts.origin ?? WEB_ORIGIN;
    if (opts.cookie) headers.cookie = opts.cookie;
    return app.inject({
      method: opts.method,
      url: opts.url,
      headers,
      remoteAddress: opts.ip ?? "10.0.0.1",
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
  };

  return {
    app,
    ctx,
    mailer,
    db,
    clock,
    request,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/** Pulls the token out of the "#token=..." fragment of the last email sent to an address. */
export function tokenFromMail(mailer: MemoryMailer, to: string): string {
  const msg = mailer.lastTo(to);
  const match = msg?.text.match(/#token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`no token mail for ${to}`);
  return match[1];
}

export function sessionCookie(res: LightMyRequestResponse, name = "__Host-inother_sid"): string {
  const c = res.cookies.find((x) => x.name === name);
  if (!c) throw new Error("no session cookie in response");
  return `${name}=${c.value}`;
}

export function registerBody(email: string, password = STRONG_PASSWORD) {
  return {
    email,
    password,
    displayName: "משתמש בדיקה",
    confirmAdult: true,
    acceptTerms: true,
    termsVersion: CURRENT_TERMS_VERSION,
  };
}

/** Registers, verifies email and logs in. Returns the session cookie. */
export async function signUpAndLogin(h: Harness, email: string): Promise<string> {
  const ip = nextIp();
  const reg = await h.request({ method: "POST", url: "/auth/register", body: registerBody(email), ip });
  if (reg.statusCode !== 202) throw new Error(`register failed: ${reg.body}`);
  const token = tokenFromMail(h.mailer, email);
  const ver = await h.request({ method: "POST", url: "/auth/verify-email", body: { token }, ip });
  if (ver.statusCode !== 200) throw new Error(`verify failed: ${ver.body}`);
  const login = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
  return sessionCookie(login);
}

export async function reauth(h: Harness, cookie: string, code?: string): Promise<void> {
  const res = await h.request({ method: "POST", url: "/auth/reauth", cookie, body: { password: STRONG_PASSWORD, ...(code ? { code } : {}) }, ip: nextIp() });
  if (res.statusCode !== 200) throw new Error(`reauth failed: ${res.body}`);
}
