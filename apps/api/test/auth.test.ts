import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { eq } from "drizzle-orm";
import { auditLog, sessions, users } from "../src/db/schema.js";
import { totpAt } from "../src/lib/totp.js";
import {
  STRONG_PASSWORD,
  createHarness,
  nextIp,
  reauth,
  registerBody,
  sessionCookie,
  signUpAndLogin,
  tokenFromMail,
  type Harness,
} from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe("registration", () => {
  it("does not reveal whether an email is already registered", async () => {
    const email = "enum@example.com";
    const first = await h.request({ method: "POST", url: "/auth/register", body: registerBody(email), ip: nextIp() });
    const second = await h.request({ method: "POST", url: "/auth/register", body: registerBody(email), ip: nextIp() });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    // The existing owner is notified instead.
    expect(h.mailer.lastTo(email)?.subject).toContain("ניסיון הרשמה");
    const rows = await h.db.db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("rejects weak passwords and invalid input without echoing values", async () => {
    const weak = await h.request({ method: "POST", url: "/auth/register", body: registerBody("weak@example.com", "password1234"), ip: nextIp() });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe("password_too_weak");

    const invalid = await h.request({ method: "POST", url: "/auth/register", body: { email: "nope", password: "x" }, ip: nextIp() });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("validation_failed");
    expect(invalid.body).not.toContain("nope");
  });

  it("requires email verification before login", async () => {
    const email = "unverified@example.com";
    const ip = nextIp();
    await h.request({ method: "POST", url: "/auth/register", body: registerBody(email), ip });
    const login = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe("email_not_verified");
    expect(login.cookies).toHaveLength(0);
  });

  it("verification tokens are single-use", async () => {
    const email = "single@example.com";
    const ip = nextIp();
    await h.request({ method: "POST", url: "/auth/register", body: registerBody(email), ip });
    const token = tokenFromMail(h.mailer, email);
    expect((await h.request({ method: "POST", url: "/auth/verify-email", body: { token }, ip })).statusCode).toBe(200);
    expect((await h.request({ method: "POST", url: "/auth/verify-email", body: { token }, ip })).statusCode).toBe(400);
  });
});

describe("login & sessions", () => {
  it("issues a hardened session cookie and stores only a token hash", async () => {
    const email = "cookie@example.com";
    const ip = nextIp();
    await h.request({ method: "POST", url: "/auth/register", body: registerBody(email), ip });
    await h.request({ method: "POST", url: "/auth/verify-email", body: { token: tokenFromMail(h.mailer, email) }, ip });
    const res = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "__Host-inother_sid");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

    const stored = await h.db.db.select().from(sessions);
    const raw = Buffer.from(cookie?.value ?? "");
    expect(stored.some((s) => s.tokenHash.equals(raw))).toBe(false);

    const me = await h.request({ method: "GET", url: "/me", cookie: sessionCookie(res) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email, emailVerified: true, mfaEnabled: false });
  });

  it("returns the same error for unknown email and wrong password", async () => {
    const email = "same-error@example.com";
    await signUpAndLogin(h, email);
    const wrong = await h.request({ method: "POST", url: "/auth/login", body: { email, password: "wrong password here" }, ip: nextIp() });
    const unknown = await h.request({ method: "POST", url: "/auth/login", body: { email: "ghost@example.com", password: "wrong password here" }, ip: nextIp() });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe(unknown.json().error.code);
  });

  it("locks the account after repeated failures, then notifies the owner", async () => {
    const email = "lockout@example.com";
    await signUpAndLogin(h, email);
    for (let i = 0; i < 5; i++) {
      await h.request({ method: "POST", url: "/auth/login", body: { email, password: "wrong password here" }, ip: nextIp() });
    }
    // Correct password is now rejected while locked (generic error).
    const locked = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
    expect(locked.statusCode).toBe(401);
    expect(h.mailer.lastTo(email)?.subject).toContain("התראת אבטחה");

    h.clock.advanceMinutes(2);
    const after = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
    expect(after.statusCode).toBe(200);
  });

  it("rate-limits credential endpoints per IP", async () => {
    const ip = nextIp();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await h.request({ method: "POST", url: "/auth/login", body: { email: "rl@example.com", password: "whatever-whatever" }, ip });
      last = r.statusCode;
    }
    expect(last).toBe(429);
  });

  it("expires idle sessions", async () => {
    const cookie = await signUpAndLogin(h, "idle@example.com");
    h.clock.advanceMinutes(60 * 24 + 1);
    const me = await h.request({ method: "GET", url: "/me", cookie });
    expect(me.statusCode).toBe(401);
  });

  it("logout revokes the session server-side", async () => {
    const cookie = await signUpAndLogin(h, "logout@example.com");
    expect((await h.request({ method: "POST", url: "/auth/logout", cookie })).statusCode).toBe(204);
    expect((await h.request({ method: "GET", url: "/me", cookie })).statusCode).toBe(401);
  });
});

describe("CSRF & transport protections", () => {
  it("rejects state-changing requests from a foreign or missing Origin", async () => {
    const cookie = await signUpAndLogin(h, "csrf@example.com");
    const foreign = await h.request({ method: "POST", url: "/auth/logout-all", cookie, origin: "https://evil.example" });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe("invalid_origin");
    const missing = await h.request({ method: "POST", url: "/auth/logout-all", cookie, origin: null });
    expect(missing.statusCode).toBe(403);
    // Session still valid.
    expect((await h.request({ method: "GET", url: "/me", cookie })).statusCode).toBe(200);
  });

  it("sets security headers and no-store", async () => {
    const res = await h.request({ method: "GET", url: "/health" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns safe JSON for unknown routes and malformed bodies", async () => {
    const nf = await h.request({ method: "GET", url: "/does-not-exist" });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe("route_not_found");
    const bad = await h.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin: "https://app.inother.test", "content-type": "application/json" },
      payload: "{not json",
      remoteAddress: nextIp(),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_json");
  });
});

describe("password reset", () => {
  it("does not reveal unknown emails and resets + revokes sessions for known ones", async () => {
    const email = "reset@example.com";
    const cookie = await signUpAndLogin(h, email);
    const unknown = await h.request({ method: "POST", url: "/auth/password-reset/request", body: { email: "nobody@example.com" }, ip: nextIp() });
    const known = await h.request({ method: "POST", url: "/auth/password-reset/request", body: { email }, ip: nextIp() });
    expect(unknown.statusCode).toBe(202);
    expect(known.statusCode).toBe(202);
    expect(unknown.json()).toEqual(known.json());

    const token = tokenFromMail(h.mailer, email);
    const newPassword = "another long passphrase 7";
    const confirm = await h.request({ method: "POST", url: "/auth/password-reset/confirm", body: { token, newPassword }, ip: nextIp() });
    expect(confirm.statusCode).toBe(200);
    // Old session revoked, token single-use, new password works.
    expect((await h.request({ method: "GET", url: "/me", cookie })).statusCode).toBe(401);
    expect((await h.request({ method: "POST", url: "/auth/password-reset/confirm", body: { token, newPassword }, ip: nextIp() })).statusCode).toBe(400);
    expect((await h.request({ method: "POST", url: "/auth/login", body: { email, password: newPassword }, ip: nextIp() })).statusCode).toBe(200);
  });

  it("reset tokens expire after 30 minutes", async () => {
    const email = "reset-expiry@example.com";
    await signUpAndLogin(h, email);
    await h.request({ method: "POST", url: "/auth/password-reset/request", body: { email }, ip: nextIp() });
    const token = tokenFromMail(h.mailer, email);
    h.clock.advanceMinutes(31);
    const res = await h.request({ method: "POST", url: "/auth/password-reset/confirm", body: { token, newPassword: "yet another passphrase 9" }, ip: nextIp() });
    expect(res.statusCode).toBe(400);
  });
});

describe("MFA (TOTP)", () => {
  it("requires recent re-authentication, enables MFA, and enforces it at login with replay protection", async () => {
    const email = "mfa@example.com";
    const cookie = await signUpAndLogin(h, email);

    // Re-auth required.
    h.clock.advanceMinutes(11);
    const noReauth = await h.request({ method: "POST", url: "/auth/mfa/setup", cookie });
    expect(noReauth.statusCode).toBe(403);
    expect(noReauth.json().error.code).toBe("reauth_required");

    await reauth(h, cookie);
    const setup = await h.request({ method: "POST", url: "/auth/mfa/setup", cookie });
    expect(setup.statusCode).toBe(200);
    const secret = decodeBase32IgnorePadding(setup.json().secret as string);
    expect(setup.json().uri).toMatch(/^otpauth:\/\/totp\//);

    // Secret stored encrypted, never in plain text.
    const [row] = await h.db.db.select().from(users).where(eq(users.email, email));
    expect(row?.totpSecretEnc?.includes(Buffer.from(secret))).toBe(false);

    const wrong = await h.request({ method: "POST", url: "/auth/mfa/confirm", cookie, body: { code: "000000" } });
    expect(wrong.statusCode).toBe(400);
    const confirm = await h.request({ method: "POST", url: "/auth/mfa/confirm", cookie, body: { code: totpAt(secret, h.clock.now.getTime()) } });
    expect(confirm.statusCode).toBe(200);
    const recoveryCodes = confirm.json().recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);

    // Login now requires the second factor.
    h.clock.advanceMinutes(1);
    const step1 = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
    expect(step1.json().status).toBe("mfa_required");
    expect(step1.cookies).toHaveLength(0);
    const challengeToken = step1.json().challengeToken as string;
    const code = totpAt(secret, h.clock.now.getTime());
    const step2 = await h.request({ method: "POST", url: "/auth/login/mfa", body: { challengeToken, code }, ip: nextIp() });
    expect(step2.statusCode).toBe(200);
    expect(sessionCookie(step2)).toBeTruthy();

    // The same code cannot be replayed on a new challenge.
    const again = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
    const replay = await h.request({ method: "POST", url: "/auth/login/mfa", body: { challengeToken: again.json().challengeToken, code }, ip: nextIp() });
    expect(replay.statusCode).toBe(401);

    // Recovery code works exactly once.
    const rc = recoveryCodes[0] as string;
    const viaRecovery = await h.request({ method: "POST", url: "/auth/login/mfa", body: { challengeToken: again.json().challengeToken, recoveryCode: rc }, ip: nextIp() });
    expect(viaRecovery.statusCode).toBe(200);
    const again2 = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
    const reuse = await h.request({ method: "POST", url: "/auth/login/mfa", body: { challengeToken: again2.json().challengeToken, recoveryCode: rc }, ip: nextIp() });
    expect(reuse.statusCode).toBe(401);
  });

  it("locks an MFA challenge after too many wrong codes", async () => {
    const email = "mfa-brute@example.com";
    const cookie = await signUpAndLogin(h, email);
    await reauth(h, cookie);
    const setup = await h.request({ method: "POST", url: "/auth/mfa/setup", cookie });
    const secret = decodeBase32IgnorePadding(setup.json().secret as string);
    await h.request({ method: "POST", url: "/auth/mfa/confirm", cookie, body: { code: totpAt(secret, h.clock.now.getTime()) } });
    h.clock.advanceMinutes(1);

    const step1 = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
    const challengeToken = step1.json().challengeToken as string;
    for (let i = 0; i < 5; i++) {
      await h.request({ method: "POST", url: "/auth/login/mfa", body: { challengeToken, code: "000000" }, ip: nextIp() });
    }
    const valid = await h.request({ method: "POST", url: "/auth/login/mfa", body: { challengeToken, code: totpAt(secret, h.clock.now.getTime()) }, ip: nextIp() });
    expect(valid.statusCode).toBe(401);
  });
});

describe("audit log", () => {
  it("records security events without personal content and is append-only", async () => {
    await signUpAndLogin(h, "audit@example.com");
    const rows = await h.db.db.select().from(auditLog);
    expect(rows.some((r) => r.action === "auth.login.success")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("audit@example.com");
    await expect(h.db.db.delete(auditLog)).rejects.toThrow();
  });
});
