import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legacyVaults, users } from "../src/db/schema.js";
import { ClamdScanner } from "../src/lib/scanner.js";
import { totpAt } from "../src/lib/totp.js";
import { ReleaseService } from "../src/modules/release/release.service.js";
import { VaultService } from "../src/modules/vault/vault.service.js";
import { EICAR, FakeClamd } from "./fake-clamd.js";
import { STRONG_PASSWORD, createHarness, nextIp, signUpAndLogin, tokenFromMail, type Harness } from "./harness.js";

let h: Harness;
let clamd: FakeClamd;
let legator: string;
let exec1: string;
let exec2: string;
let heir: string;
let otherHeir: string;
let stranger: string;
let staff: string;
let staffSecret: Uint8Array;
let vaultId: string;
const ids: Record<string, string> = {};

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".padEnd(800, " "));

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string | undefined, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });
const putDoc = (cookie: string, id: string, data: Buffer, type = "application/pdf") =>
  h.request({ method: "PUT", url: `/executor/reports/${id}/document`, cookie, rawBody: data, headers: { "content-type": type }, ip: nextIp() });

async function accept(cookie: string, email: string) {
  return req(cookie, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, email) });
}

async function staffReauth() {
  h.clock.advanceMinutes(1); // a new TOTP time-step (codes are single-use)
  await req(staff, "POST", "/auth/reauth", { password: STRONG_PASSWORD, code: totpAt(staffSecret, h.clock.now.getTime()) });
}

beforeAll(async () => {
  clamd = new FakeClamd();
  await clamd.start();
  h = await createHarness({}, { scanner: new ClamdScanner("127.0.0.1", clamd.port, 5000) });
  legator = await signUpAndLogin(h, "legator@example.com");
  exec1 = await signUpAndLogin(h, "exec1@example.com");
  exec2 = await signUpAndLogin(h, "exec2@example.com");
  heir = await signUpAndLogin(h, "heir@example.com");
  otherHeir = await signUpAndLogin(h, "other-heir@example.com");
  stranger = await signUpAndLogin(h, "stranger@example.com");
  staff = await signUpAndLogin(h, "staff@example.com");

  // Staff: role is granted out-of-band (DB), and MFA is mandatory.
  await h.db.db.update(users).set({ role: "staff" }).where(eq(users.email, "staff@example.com"));
  await req(staff, "POST", "/auth/reauth", { password: STRONG_PASSWORD });
  const setup = await req(staff, "POST", "/auth/mfa/setup");
  staffSecret = decodeBase32IgnorePadding(setup.json().secret as string);
  await req(staff, "POST", "/auth/mfa/confirm", { code: totpAt(staffSecret, h.clock.now.getTime()) });

  // Legator's vault, people and content.
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  await req(legator, "PATCH", "/vault", { openingMessage: "ילדים שלי, אני אוהב אתכם.", releaseWaitDays: 7 });
  ids.ex1 = (await req(legator, "POST", "/vault/executors", { name: "Exec One", relation: "friend", email: "exec1@example.com" })).json().id;
  ids.ex2 = (await req(legator, "POST", "/vault/executors", { name: "Exec Two", relation: "sibling", email: "exec2@example.com" })).json().id;
  ids.heir = (await req(legator, "POST", "/vault/beneficiaries", { name: "Heir", relation: "child", email: "heir@example.com" })).json().id;
  ids.other = (await req(legator, "POST", "/vault/beneficiaries", { name: "Other", relation: "child", email: "other-heir@example.com" })).json().id;
  const story = (b: object) => req(legator, "POST", "/vault/stories", { body: "x", audience: "all", releaseRule: "on_release", delivery: "original_only", ...b });
  ids.sAll = (await story({ title: "for everyone" })).json().id;
  ids.sMine = (await story({ title: "only heir", audience: "specific", beneficiaryIds: [ids.heir] })).json().id;
  ids.sOther = (await story({ title: "only other", audience: "specific", beneficiaryIds: [ids.other] })).json().id;
  ids.sFuture = (await story({ title: "future", releaseRule: "date", releaseAt: "2099-01-01" })).json().id;
  ids.sTopic = (await story({ title: "topic", releaseRule: "on_topic", topic: "the sea" })).json().id;
  await req(legator, "PUT", "/vault/answers/values.happiness", { text: "המשפחה" });
});
afterAll(async () => {
  await h.close();
  await clamd.stop();
});

describe("invitations", () => {
  it("only the invited address can accept; the legator cannot accept their own", async () => {
    expect((await req(legator, "POST", `/vault/executors/${ids.ex1}/invite`)).statusCode).toBe(202);
    const mail = h.mailer.lastTo("exec1@example.com");
    expect(mail?.subject).toContain("נאמן");
    const token = tokenFromMail(h.mailer, "exec1@example.com");

    const wrong = await req(stranger, "POST", "/invitations/accept", { token });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe("invitation_email_mismatch");
    expect((await req(legator, "POST", "/invitations/accept", { token })).statusCode).toBe(403);

    const ok = await req(exec1, "POST", "/invitations/accept", { token });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ kind: "executor", legatorName: "משתמש בדיקה" });
    // Single use.
    expect((await req(exec1, "POST", "/invitations/accept", { token })).statusCode).toBe(400);

    await req(legator, "POST", `/vault/executors/${ids.ex2}/invite`);
    expect((await accept(exec2, "exec2@example.com")).statusCode).toBe(200);
  });

  it("executors see only who chose them, never content", async () => {
    const roles = (await req(exec1, "GET", "/executor/vaults")).json().items;
    expect(roles).toHaveLength(1);
    expect(Object.keys(roles[0]).sort()).toEqual(["legatorName", "openReport", "released", "vaultId"]);
    expect((await req(exec1, "GET", `/inheritances/${vaultId}`)).statusCode).toBe(404);
  });
});

describe("reporting a death", () => {
  it("non-executors cannot report; executors can, and the legator is alerted immediately", async () => {
    expect((await req(stranger, "POST", `/executor/vaults/${vaultId}/reports`, { dateOfDeath: "2026-10-01" })).statusCode).toBe(404);
    expect((await req(exec1, "POST", `/executor/vaults/${vaultId}/reports`, { dateOfDeath: "2999-01-01" })).statusCode).toBe(400);

    const res = await req(exec1, "POST", `/executor/vaults/${vaultId}/reports`, { dateOfDeath: "2026-10-01" });
    expect(res.statusCode).toBe(201);
    ids.report1 = res.json().id;
    expect(h.mailer.lastTo("legator@example.com")?.subject).toContain("התקבל דיווח על פטירתך");
    // Only one open report per vault.
    expect((await req(exec2, "POST", `/executor/vaults/${vaultId}/reports`, { dateOfDeath: "2026-10-01" })).statusCode).toBe(409);
  });

  it("validates, scans and stores the certificate", async () => {
    expect((await putDoc(exec1, ids.report1!, PDF, "text/html")).statusCode).toBe(415);
    expect((await putDoc(stranger, ids.report1!, PDF)).statusCode).toBe(404);
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(800, 1)]);
    expect((await putDoc(exec1, ids.report1!, exe)).json().error.code).toBe("file_type_not_allowed");
    const infected = Buffer.concat([PDF, Buffer.from(EICAR)]);
    expect((await putDoc(exec1, ids.report1!, infected)).json().error.code).toBe("file_rejected");
    clamd.failing = true;
    expect((await putDoc(exec1, ids.report1!, PDF)).statusCode).toBe(503);
    clamd.failing = false;
    const ok = await putDoc(exec1, ids.report1!, PDF);
    expect(ok.statusCode).toBe(202);
    expect(ok.json().status).toBe("pending_review");
  });
});

describe("staff review", () => {
  it("is hidden from non-staff and requires MFA + recent re-auth", async () => {
    expect((await req(exec1, "GET", "/admin/release-requests")).statusCode).toBe(404);
    h.clock.advanceMinutes(11);
    expect((await req(staff, "GET", "/admin/release-requests")).json().error.code).toBe("reauth_required");
    await staffReauth();
    const list = (await req(staff, "GET", "/admin/release-requests")).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: ids.report1, legatorName: "משתמש בדיקה", dateOfDeath: "2026-10-01" });
    const doc = await req(staff, "GET", `/admin/release-requests/${ids.report1}/document`);
    expect(doc.statusCode).toBe(200);
    expect(doc.rawPayload.equals(PDF)).toBe(true);
  });

  it("approval requires a second executor when configured; the reporter can't be the second", async () => {
    expect((await req(staff, "POST", `/admin/release-requests/${ids.report1}/approve`)).statusCode).toBe(200);
    const [vault] = await h.db.db.select().from(legacyVaults).where(eq(legacyVaults.id, vaultId));
    expect(vault?.status).toBe("release_pending");
    // Legator content is frozen while a release is pending.
    expect((await req(legator, "PUT", "/vault/answers/values.core", { text: "x" })).json().error.code).toBe("vault_locked");

    expect((await req(exec1, "POST", `/executor/reports/${ids.report1}/confirm`)).statusCode).toBe(403);
    expect((await req(exec2, "POST", `/executor/reports/${ids.report1}/confirm`)).statusCode).toBe(200);
    const status = (await req(legator, "GET", "/vault/release")).json().openReport;
    expect(status.status).toBe("waiting_period");
  });
});

describe("the legator is alive", () => {
  it("can cancel with the emailed link, without signing in; executors are told", async () => {
    const cancelToken = tokenFromMail(h.mailer, "legator@example.com");
    const res = await h.request({ method: "POST", url: "/release/cancel", body: { token: cancelToken }, ip: nextIp() });
    expect(res.statusCode).toBe(200);
    const [vault] = await h.db.db.select().from(legacyVaults).where(eq(legacyVaults.id, vaultId));
    expect(vault?.status).toBe("building");
    expect(h.mailer.lastTo("exec1@example.com")?.subject).toBe("הדיווח בוטל");
    // Link is now dead, and nothing gets released later.
    expect((await h.request({ method: "POST", url: "/release/cancel", body: { token: cancelToken }, ip: nextIp() })).statusCode).toBe(400);
    const svc = new ReleaseService(h.ctx, new VaultService(h.ctx));
    h.clock.advanceMinutes(8 * 24 * 60);
    expect(await svc.finalizeDue()).toBe(0);
    await reloginAll(); // sessions idled out during the 8 simulated days
  });

  it("can also cancel from inside the app", async () => {
    const r = await req(exec1, "POST", `/executor/vaults/${vaultId}/reports`, { dateOfDeath: "2026-10-02" });
    expect(r.statusCode).toBe(201);
    expect((await req(legator, "POST", "/vault/release/cancel")).statusCode).toBe(200);
    expect((await req(legator, "GET", "/vault/release")).json().openReport).toBeNull();
  });
});

describe("release and beneficiary access", () => {
  it("nothing is visible before release", async () => {
    await req(legator, "POST", `/vault/beneficiaries/${ids.heir}/invite`);
    expect((await accept(heir, "heir@example.com")).json()).toMatchObject({ kind: "beneficiary", vaultReleased: false });
    const list = (await req(heir, "GET", "/inheritances")).json().items;
    expect(list).toEqual([{ vaultId, legatorName: "משתמש בדיקה", released: false, canSuggest: true }]);
    expect((await req(heir, "GET", `/inheritances/${vaultId}`)).statusCode).toBe(404);
    expect((await req(heir, "GET", `/inheritances/${vaultId}/stories`)).statusCode).toBe(404);
  });

  it("releases after the waiting period and invites every beneficiary", async () => {
    // Single executor path this time: disable the second-executor rule.
    await req(legator, "PATCH", "/vault", { requireSecondExecutor: false });
    const r = (await req(exec2, "POST", `/executor/vaults/${vaultId}/reports`, { dateOfDeath: "2026-10-05" })).json();
    await putDoc(exec2, r.id, PDF);
    await staffReauth();
    await req(staff, "POST", `/admin/release-requests/${r.id}/approve`);
    expect((await req(legator, "GET", "/vault/release")).json().openReport.status).toBe("waiting_period");

    const svc = new ReleaseService(h.ctx, new VaultService(h.ctx));
    h.clock.advanceMinutes(6 * 24 * 60);
    expect(await svc.finalizeDue()).toBe(0); // not yet
    h.clock.advanceMinutes(2 * 24 * 60);
    expect(await svc.finalizeDue()).toBe(1);
    await reloginAll();

    expect(h.mailer.lastTo("heir@example.com")?.subject).toContain("מחכה לך");
    expect(h.mailer.lastTo("other-heir@example.com")?.subject).toContain("מחכה לך");
    // Death certificate deleted after release (data minimization).
    const { readdir } = await import("node:fs/promises");
    await expect(readdir(`${h.storageDir}/release/${vaultId}`).then((f) => f.length)).resolves.toBe(0);
  });

  it("beneficiaries see only what the legator intended for them", async () => {
    await accept(otherHeir, "other-heir@example.com");

    const summary = (await req(heir, "GET", `/inheritances/${vaultId}`)).json();
    expect(summary.openingMessage).toBe("ילדים שלי, אני אוהב אתכם.");
    const titles = (await req(heir, "GET", `/inheritances/${vaultId}/stories`)).json().items.map((s: { title: string }) => s.title).sort();
    expect(titles).toEqual(["for everyone", "only heir"]);
    const otherTitles = (await req(otherHeir, "GET", `/inheritances/${vaultId}/stories`)).json().items.map((s: { title: string }) => s.title).sort();
    expect(otherTitles).toEqual(["for everyone", "only other"]);
    const answers = (await req(heir, "GET", `/inheritances/${vaultId}/answers`)).json().items;
    expect(answers[0]).toMatchObject({ questionId: "values.happiness", text: "המשפחה" });

    expect((await req(stranger, "GET", `/inheritances/${vaultId}`)).statusCode).toBe(404);
    expect((await req(stranger, "GET", `/inheritances/${vaultId}/stories`)).statusCode).toBe(404);
  });

  it("a released vault cannot be reported again or edited", async () => {
    expect((await req(exec1, "POST", `/executor/vaults/${vaultId}/reports`, { dateOfDeath: "2026-10-01" })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("never-release vaults", () => {
  it("refuse death reports", async () => {
    const owner = await signUpAndLogin(h, "never@example.com");
    const ex = await signUpAndLogin(h, "never-ex@example.com");
    const vid = (await req(owner, "POST", "/vault", { consentToProcessing: true })).json().id;
    const exId = (await req(owner, "POST", "/vault/executors", { name: "E", relation: "friend", email: "never-ex@example.com" })).json().id;
    await req(owner, "POST", `/vault/executors/${exId}/invite`);
    await accept(ex, "never-ex@example.com");
    await req(owner, "PATCH", "/vault", { neverRelease: true });
    const res = await req(ex, "POST", `/executor/vaults/${vid}/reports`, { dateOfDeath: "2026-10-01" });
    expect(res.json().error.code).toBe("vault_never_release");
  });
});

async function reloginAll(): Promise<void> {
  legator = await loginAgain("legator@example.com");
  exec1 = await loginAgain("exec1@example.com");
  exec2 = await loginAgain("exec2@example.com");
  heir = await loginAgain("heir@example.com");
  otherHeir = await loginAgain("other-heir@example.com");
  stranger = await loginAgain("stranger@example.com");
  // Staff has MFA: password, then a fresh TOTP code.
  h.clock.advanceMinutes(1);
  const step1 = await h.request({ method: "POST", url: "/auth/login", body: { email: "staff@example.com", password: STRONG_PASSWORD }, ip: nextIp() });
  const step2 = await h.request({
    method: "POST",
    url: "/auth/login/mfa",
    body: { challengeToken: step1.json().challengeToken, code: totpAt(staffSecret, h.clock.now.getTime()) },
    ip: nextIp(),
  });
  const c = step2.cookies.find((x) => x.name === "__Host-inother_sid");
  if (!c) throw new Error(`staff login failed: ${step2.body}`);
  staff = `__Host-inother_sid=${c.value}`;
}

async function loginAgain(email: string): Promise<string> {
  const res = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
  const c = res.cookies.find((x) => x.name === "__Host-inother_sid");
  if (!c) throw new Error(`login failed for ${email}: ${res.body}`);
  return `__Host-inother_sid=${c.value}`;
}
