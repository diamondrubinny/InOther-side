import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLinks, legacyVaults } from "../src/db/schema.js";
import { CaptureService } from "../src/modules/capture/capture.service.js";
import { MediaService } from "../src/modules/media/media.service.js";
import { VaultService } from "../src/modules/vault/vault.service.js";
import { STRONG_PASSWORD, createHarness, nextIp, signUpAndLogin, tokenFromMail, type Harness } from "./harness.js";

let h: Harness;
let svc: CaptureService;
let legator: string;
let heir: string;
let stranger: string;
let otherLegator: string;
let vaultId: string;
const ids: Record<string, string> = {};

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string | undefined, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });
const anon = (url: string, body: unknown) => h.request({ method: "POST", url, body, ip: nextIp() });
const tokenOf = (url: string) => new URL(url).hash.replace("#token=", "");
const fakeMp3 = () => Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2400, 1)]);
const putAudio = (token: string, data: Buffer, type = "audio/mpeg") =>
  h.request({ method: "PUT", url: "/capture/audio", rawBody: data, headers: { "content-type": type, "x-capture-token": token }, ip: nextIp() });

async function loginAgain(email: string): Promise<string> {
  const res = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
  const c = res.cookies.find((x) => x.name === "__Host-inother_sid");
  if (!c) throw new Error(`login failed: ${res.body}`);
  return `__Host-inother_sid=${c.value}`;
}

beforeAll(async () => {
  h = await createHarness();
  svc = new CaptureService(h.ctx, new VaultService(h.ctx), new MediaService(h.ctx, new VaultService(h.ctx)));
  legator = await signUpAndLogin(h, "c-legator@example.com");
  heir = await signUpAndLogin(h, "c-heir@example.com");
  stranger = await signUpAndLogin(h, "c-stranger@example.com");
  otherLegator = await signUpAndLogin(h, "c-other@example.com");
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  await req(otherLegator, "POST", "/vault", { consentToProcessing: true });
  ids.heir = (await req(legator, "POST", "/vault/beneficiaries", { name: "Noa", relation: "grandchild", email: "c-heir@example.com" })).json().id;
  await req(legator, "POST", `/vault/beneficiaries/${ids.heir}/invite`);
  await req(heir, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, "c-heir@example.com") });
});
afterAll(async () => {
  await h.close();
});

describe("capture links (legator)", () => {
  it("issues a link to the next unanswered non-sensitive question; the token is returned once and stored hashed", async () => {
    await req(legator, "PUT", "/vault/answers/childhood.home", { text: "already answered" });
    const res = await req(legator, "POST", "/vault/capture-links", { source: "catalog" });
    expect(res.statusCode).toBe(201);
    const link = res.json();
    expect(link.url).toMatch(/^https:\/\/app\.inother\.test\/he\/capture#token=[A-Za-z0-9_-]{40,}$/);
    expect(link.question).toBeTruthy();
    ids.catalogToken = tokenOf(link.url);
    ids.catalogLink = link.id;
    const [row] = await h.db.db.select().from(captureLinks).where(eq(captureLinks.id, link.id));
    expect(row?.questionId).not.toBe("childhood.home");
    expect(row?.tokenHash.toString("hex")).not.toContain(ids.catalogToken);
    // The list never exposes tokens.
    const list = (await req(legator, "GET", "/vault/capture-links")).json().items;
    expect(JSON.stringify(list)).not.toContain(ids.catalogToken);
    expect(list[0]).toMatchObject({ id: link.id, status: "active", source: "catalog" });
  });

  it("can send the link only to the legator's own email", async () => {
    const res = await req(legator, "POST", "/vault/capture-links", { source: "custom", text: "מה השיר שהכי אהבת?", sendToMyEmail: true });
    expect(res.statusCode).toBe(201);
    const mail = h.mailer.lastTo("c-legator@example.com");
    expect(mail?.subject).toBe("שאלה אחת בשבילך");
    expect(mail?.text).toContain("מה השיר שהכי אהבת?");
    expect(mail?.text).toContain(res.json().url);
    ids.customToken = tokenOf(res.json().url);
    ids.customLink = res.json().id;
    // There is no field for another recipient.
    const other = await req(legator, "POST", "/vault/capture-links", { source: "custom", text: "abc def", to: "victim@example.com" });
    expect(h.mailer.lastTo("victim@example.com")).toBeUndefined();
    expect(other.statusCode).toBe(201);
  });

  it("other users cannot list or revoke the legator's links (IDOR)", async () => {
    expect((await req(otherLegator, "GET", "/vault/capture-links")).json().items).toHaveLength(0);
    expect((await req(otherLegator, "DELETE", `/vault/capture-links/${ids.catalogLink}`)).statusCode).toBe(404);
    expect((await req(stranger, "DELETE", `/vault/capture-links/${ids.catalogLink}`)).statusCode).toBe(404);
  });
});

describe("public capture page (no account)", () => {
  it("shows only the question and the legator's name; bad tokens get one uniform error", async () => {
    const s = await anon("/capture/session", { token: ids.customToken });
    expect(s.statusCode).toBe(200);
    expect(Object.keys(s.json()).sort()).toEqual(["expiresAt", "name", "question"]);
    expect(s.json().question).toBe("מה השיר שהכי אהבת?");
    const bad = await anon("/capture/session", { token: "x".repeat(43) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_or_expired_token");
  });

  it("a text answer to a custom question goes to the interview material, once", async () => {
    expect((await anon("/capture/answer", { token: ids.customToken, text: "ירושלים של זהב, בגלל אמא שלי" })).statusCode).toBe(201);
    const again = await anon("/capture/answer", { token: ids.customToken, text: "again" });
    expect(again.json().error.code).toBe("invalid_or_expired_token");
    expect((await anon("/capture/session", { token: ids.customToken })).statusCode).toBe(400);
    const entries = (await req(legator, "GET", "/interview/entries")).json().items;
    expect(entries.find((e: { answer: string }) => e.answer === "ירושלים של זהב, בגלל אמא שלי")).toMatchObject({ question: "מה השיר שהכי אהבת?", viaLink: true });
  });

  it("a text answer to a catalog question goes to guided answers (marked 'via link' until the legator edits it)", async () => {
    const [row] = await h.db.db.select().from(captureLinks).where(eq(captureLinks.id, ids.catalogLink as string));
    expect((await anon("/capture/answer", { token: ids.catalogToken, text: "תשובה מהקישור" })).statusCode).toBe(201);
    let answers = (await req(legator, "GET", "/vault/answers")).json().items;
    expect(answers.find((a: { questionId: string }) => a.questionId === row?.questionId)).toMatchObject({ text: "תשובה מהקישור", viaLink: true });
    await req(legator, "PUT", `/vault/answers/${row?.questionId}`, { text: "תיקנתי" });
    answers = (await req(legator, "GET", "/vault/answers")).json().items;
    expect(answers.find((a: { questionId: string }) => a.questionId === row?.questionId)).toMatchObject({ text: "תיקנתי", viaLink: false });
  });

  it("a voice answer goes through the media pipeline; wrong types are refused without using the link", async () => {
    const link = (await req(legator, "POST", "/vault/capture-links", { source: "custom", text: "ספר/י על החתונה" })).json();
    const token = tokenOf(link.url);
    expect((await putAudio(token, Buffer.from("<html>"), "text/html")).statusCode).toBe(415);
    expect((await putAudio("y".repeat(43), fakeMp3())).statusCode).toBe(400);
    expect((await anon("/capture/session", { token })).statusCode).toBe(200); // still usable
    const ok = await putAudio(token, fakeMp3());
    expect(ok.statusCode).toBe(201);
    const media = (await req(legator, "GET", "/vault/media")).json().items;
    expect(media.find((m: { label: string }) => m.label === "ספר/י על החתונה")).toMatchObject({ kind: "audio", status: "clean", viaLink: true });
    expect((await putAudio(token, fakeMp3())).statusCode).toBe(400);
  });

  it("a revoked or expired link stops working", async () => {
    const a = (await req(legator, "POST", "/vault/capture-links", { source: "custom", text: "revoke me" })).json();
    expect((await req(legator, "DELETE", `/vault/capture-links/${a.id}`)).statusCode).toBe(204);
    expect((await anon("/capture/session", { token: tokenOf(a.url) })).statusCode).toBe(400);
    const b = (await req(legator, "POST", "/vault/capture-links", { source: "custom", text: "expire me" })).json();
    h.clock.advanceMinutes(7 * 24 * 60 + 1);
    expect((await anon("/capture/answer", { token: tokenOf(b.url), text: "late" })).statusCode).toBe(400);
    legator = await loginAgain("c-legator@example.com");
    heir = await loginAgain("c-heir@example.com");
    stranger = await loginAgain("c-stranger@example.com");
    otherLegator = await loginAgain("c-other@example.com");
    const list = (await req(legator, "GET", "/vault/capture-links")).json().items;
    expect(list.find((l: { id: string }) => l.id === a.id).status).toBe("revoked");
    expect(list.find((l: { id: string }) => l.id === b.id).status).toBe("expired");
  });
});

describe("questions from the family", () => {
  it("an accepted beneficiary suggests; strangers and other legators cannot", async () => {
    expect((await req(stranger, "POST", `/inheritances/${vaultId}/suggestions`, { text: "hi there" })).statusCode).toBe(404);
    const res = await req(heir, "POST", `/inheritances/${vaultId}/suggestions`, { text: "סבא, איך הכרת את סבתא?" });
    expect(res.statusCode).toBe(201);
    ids.suggestion = res.json().id;
    expect(h.mailer.lastTo("c-legator@example.com")?.subject).toContain("Noa");
    const mine = (await req(heir, "GET", `/inheritances/${vaultId}/suggestions`)).json().items;
    expect(mine).toEqual([expect.objectContaining({ text: "סבא, איך הכרת את סבתא?", status: "pending" })]);
    const forLegator = (await req(legator, "GET", "/vault/suggestions")).json().items;
    expect(forLegator[0]).toMatchObject({ from: "Noa", text: "סבא, איך הכרת את סבתא?", status: "pending" });
    expect((await req(otherLegator, "POST", `/vault/suggestions/${ids.suggestion}/accept`)).statusCode).toBe(404);
  });

  it("the weekly question sends the accepted family question first, once per week day", async () => {
    await req(legator, "POST", `/vault/suggestions/${ids.suggestion}/accept`);
    const weekday = new Date(h.clock.now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })).getDay();
    await req(legator, "PUT", "/vault/capture-preferences", { weeklyEnabled: true, weekday: (weekday + 1) % 7 });
    expect(await svc.sendWeekly()).toBe(0); // not today
    await req(legator, "PUT", "/vault/capture-preferences", { weeklyEnabled: true, weekday });
    expect(await svc.sendWeekly()).toBe(1);
    expect(await svc.sendWeekly()).toBe(0); // idempotent
    const mail = h.mailer.lastTo("c-legator@example.com");
    expect(mail?.subject).toBe("השאלה של השבוע");
    expect(mail?.text).toContain("סבא, איך הכרת את סבתא?");
    const token = mail?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1] as string;

    // The legator answers; the suggester sees "answered" — never the answer.
    expect((await anon("/capture/answer", { token, text: "בריקוד בתל אביב, 1961" })).statusCode).toBe(201);
    const mine = (await req(heir, "GET", `/inheritances/${vaultId}/suggestions`)).json();
    expect(mine.items[0].status).toBe("answered");
    expect(JSON.stringify(mine)).not.toContain("1961");
  });

  it("suggestions stop once the vault is released or locked; links stop too", async () => {
    const link = (await req(legator, "POST", "/vault/capture-links", { source: "custom", text: "before release" })).json();
    await h.db.db.update(legacyVaults).set({ status: "release_pending" }).where(eq(legacyVaults.id, vaultId));
    expect((await req(heir, "POST", `/inheritances/${vaultId}/suggestions`, { text: "too late?" })).statusCode).toBe(404);
    expect((await anon("/capture/session", { token: tokenOf(link.url) })).statusCode).toBe(400);
    expect((await req(legator, "POST", "/vault/capture-links", { source: "catalog" })).statusCode).toBe(409);
    await h.db.db.update(legacyVaults).set({ status: "building" }).where(eq(legacyVaults.id, vaultId));
  });
});
