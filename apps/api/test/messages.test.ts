import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hebrewFromIso, messageTriggerSchema, nextOccurrence } from "@inother/shared";
import { legacyVaults, releaseRequests, scheduledMessageRecipients } from "../src/db/schema.js";
import { MessagesService } from "../src/modules/messages/messages.service.js";
import { VaultService } from "../src/modules/vault/vault.service.js";
import { STRONG_PASSWORD, createHarness, nextIp, signUpAndLogin, tokenFromMail, type Harness } from "./harness.js";

let h: Harness;
let svc: MessagesService;
let legator: string;
let heir: string; // minor (birth date given)
let adult: string;
let other: string;
let stranger: string;
let vaultId: string;
const ids: Record<string, string> = {};

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string | undefined, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });
async function loginAgain(email: string): Promise<string> {
  const res = await h.request({ method: "POST", url: "/auth/login", body: { email, password: STRONG_PASSWORD }, ip: nextIp() });
  const c = res.cookies.find((x) => x.name === "__Host-inother_sid");
  if (!c) throw new Error(`login failed for ${email}: ${res.body}`);
  return `__Host-inother_sid=${c.value}`;
}
/** Moves the clock to a civil day (08:00 UTC) and signs everyone in again (sessions expire). */
async function setDay(iso: string, relogin = true) {
  h.clock.now = new Date(`${iso}T08:00:00Z`);
  if (!relogin) return;
  legator = await loginAgain("m-legator@example.com");
  heir = await loginAgain("m-heir@example.com");
  adult = await loginAgain("m-adult@example.com");
  other = await loginAgain("m-other@example.com");
  stranger = await loginAgain("m-stranger@example.com");
}
const fakeMp3 = () => Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2400, 1)]);
const msg = (b: object) => req(legator, "POST", "/vault/messages", { title: "t", body: "b", ...b });
const inbox = async (cookie: string) => (await req(cookie, "GET", `/inheritances/${vaultId}/messages`)).json();

beforeAll(async () => {
  h = await createHarness();
  await setDay("2026-06-01", false);
  svc = new MessagesService(h.ctx, new VaultService(h.ctx));
  legator = await signUpAndLogin(h, "m-legator@example.com");
  heir = await signUpAndLogin(h, "m-heir@example.com");
  adult = await signUpAndLogin(h, "m-adult@example.com");
  other = await signUpAndLogin(h, "m-other@example.com");
  stranger = await signUpAndLogin(h, "m-stranger@example.com");
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  ids.heir = (await req(legator, "POST", "/vault/beneficiaries", { name: "Noa", relation: "grandchild", email: "m-heir@example.com", birthDate: "2015-02-20" })).json().id;
  ids.adult = (await req(legator, "POST", "/vault/beneficiaries", { name: "Dan", relation: "child", email: "m-adult@example.com", notifyBeforeDeath: true })).json().id;
  ids.other = (await req(legator, "POST", "/vault/beneficiaries", { name: "Other", relation: "child", email: "m-other@example.com" })).json().id;
  const c = (await req(legator, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: fakeMp3().length })).json();
  await h.request({ method: "PUT", url: c.uploadUrl, cookie: legator, rawBody: fakeMp3(), headers: { "content-type": "audio/mpeg" }, ip: nextIp() });
  ids.media = c.id;
});
afterAll(async () => {
  await h.close();
});

describe("beneficiary birth date", () => {
  it("is stored encrypted, validated, and partial updates keep other fields", async () => {
    const list = (await req(legator, "GET", "/vault/beneficiaries")).json().items;
    expect(list.find((b: { id: string }) => b.id === ids.heir)).toMatchObject({ birthDate: "2015-02-20", bornAfterSunset: false });
    expect((await req(legator, "PATCH", `/vault/beneficiaries/${ids.adult}`, { birthDate: "2999-01-01" })).json().error.code).toBe("invalid_birth_date");
    // Regression: renaming used to reset notifyBeforeDeath to false (defaults inside .partial()).
    const upd = (await req(legator, "PATCH", `/vault/beneficiaries/${ids.adult}`, { name: "Danny" })).json();
    expect(upd).toMatchObject({ name: "Danny", notifyBeforeDeath: true, birthDate: null });
  });
});

describe("legator composes messages", () => {
  it("validates recipients, birth dates and attachments", async () => {
    expect((await msg({ beneficiaryIds: [ids.adult], trigger: { kind: "birthday", calendar: "hebrew", repeat: true } })).json().error.code).toBe("birth_date_required");
    expect((await msg({ beneficiaryIds: ["00000000-0000-4000-8000-000000000000"], trigger: { kind: "on_release" } })).json().error.code).toBe("invalid_beneficiary");
    expect((await msg({ beneficiaryIds: [ids.adult], trigger: { kind: "on_release" }, mediaId: "00000000-0000-4000-8000-000000000000" })).json().error.code).toBe("invalid_media");
    expect((await msg({ beneficiaryIds: [ids.adult], trigger: { kind: "annual", calendar: "gregorian", month: 2, day: 30, repeat: true } })).statusCode).toBe(400);
    expect((await msg({ beneficiaryIds: [], trigger: { kind: "on_release" } })).statusCode).toBe(400);
  });

  it("creates, lists, edits and deletes; strangers get 404", async () => {
    const created = await msg({ title: "מכתב פרידה", body: "אהבתי אתכם תמיד", beneficiaryIds: [ids.heir, ids.adult], trigger: { kind: "on_release" } });
    expect(created.statusCode).toBe(201);
    ids.mRelease = created.json().id;
    ids.mYahrzeit = (await msg({ title: "ביום השנה", beneficiaryIds: [ids.adult], trigger: { kind: "yahrzeit", repeat: true } })).json().id;
    ids.mPesach = (await msg({ title: "ערב פסח", beneficiaryIds: [ids.adult], trigger: { kind: "holiday", holiday: "pesach", repeat: true } })).json().id;
    ids.mWedding = (await msg({ title: "SECRET-WEDDING-TITLE", body: "מזל טוב", beneficiaryIds: [ids.adult], trigger: { kind: "life_event", event: "wedding" } })).json().id;
    ids.mBirthday = (await msg({ title: "יום הולדת עברי", beneficiaryIds: [ids.heir], trigger: { kind: "birthday", calendar: "hebrew", repeat: true } })).json().id;
    ids.mShloshim = (await msg({ title: "שלושים", beneficiaryIds: [ids.adult], trigger: { kind: "after_death", days: 30 } })).json().id;
    ids.mMedia = (await msg({ title: "הקלטה בשבילך", beneficiaryIds: [ids.other], trigger: { kind: "on_release" }, mediaId: ids.media })).json().id;
    const tmp = (await msg({ title: "tmp", beneficiaryIds: [ids.adult], trigger: { kind: "on_release" } })).json().id;

    const list = (await req(legator, "GET", "/vault/messages")).json().items;
    expect(list).toHaveLength(8);
    expect(list[0]).toMatchObject({ title: "מכתב פרידה", trigger: { kind: "on_release" } });
    expect(list[0].beneficiaryIds.sort()).toEqual([ids.heir, ids.adult].sort());

    const edited = await req(legator, "PUT", `/vault/messages/${tmp}`, { title: "tmp2", body: "x", beneficiaryIds: [ids.other], trigger: { kind: "date", date: "2030-01-01" } });
    expect(edited.json()).toMatchObject({ title: "tmp2", beneficiaryIds: [ids.other], trigger: { kind: "date", date: "2030-01-01" } });
    expect((await req(stranger, "GET", `/vault/messages/${tmp}`)).statusCode).toBe(404);
    expect((await req(stranger, "DELETE", `/vault/messages/${tmp}`)).statusCode).toBe(404);
    expect((await req(legator, "DELETE", `/vault/messages/${tmp}`)).statusCode).toBe(204);

    const exported = (await req(legator, "POST", "/auth/reauth", { password: "a-very-long passphrase 42" }), await req(legator, "GET", "/vault/export")).json();
    expect(exported.scheduledMessages).toHaveLength(7);
    expect(exported.scheduledMessages[0]).toMatchObject({ title: "מכתב פרידה", body: "אהבתי אתכם תמיד" });
  });

  it("nothing is delivered and nothing is visible before release", async () => {
    for (const [b, cookie, email] of [
      [ids.heir, heir, "m-heir@example.com"],
      [ids.adult, adult, "m-adult@example.com"],
      [ids.other, other, "m-other@example.com"],
    ] as const) {
      await req(legator, "POST", `/vault/beneficiaries/${b}/invite`);
      expect((await req(cookie, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, email) })).statusCode).toBe(200);
    }
    expect((await req(adult, "GET", `/inheritances/${vaultId}/messages`)).statusCode).toBe(404);
    expect(await svc.deliverDue()).toEqual({ initialized: 0, delivered: 0 });
  });
});

describe("after release", () => {
  beforeAll(async () => {
    await setDay("2026-11-25");
    await h.db.db.insert(releaseRequests).values({
      vaultId,
      status: "released",
      dateOfDeath: "2026-11-02",
      deathAfterSunset: false,
      cancelTokenHash: Buffer.alloc(32),
      releasedAt: h.clock.now,
    });
    await h.db.db.update(legacyVaults).set({ status: "released" }).where(eq(legacyVaults.id, vaultId));
  });

  it("delivers 'on release' letters with a content-free email; days-after-death waits", async () => {
    const before = h.mailer.sent.length;
    const r = await svc.deliverDue();
    expect(r.delivered).toBe(3); // heir + adult (farewell), other (with recording)
    const mail = h.mailer.lastTo("m-adult@example.com");
    expect(mail?.subject).toContain("מסר");
    expect(mail?.text).not.toContain("אהבתי אתכם");
    expect(mail?.text).toContain(`/he/app/inheritances/${vaultId}`);
    expect(h.mailer.sent.length - before).toBe(3);
    // Idempotent.
    expect((await svc.deliverDue()).delivered).toBe(0);
  });

  it("the inbox shows only my letters; 'open when' shows the event, never the title", async () => {
    const box = await inbox(adult);
    expect(box.delivered).toHaveLength(1);
    expect(box.delivered[0]).toMatchObject({ title: "מכתב פרידה", opened: false, canStop: false });
    expect(box.openWhen).toEqual([{ messageId: ids.mWedding, event: "wedding", label: null }]);
    expect(JSON.stringify(box)).not.toContain("SECRET-WEDDING-TITLE");
    expect(box.upcomingCount).toBe(3); // yahrzeit, pesach, shloshim

    const read = (await req(adult, "GET", `/inheritances/${vaultId}/messages/${box.delivered[0].id}`)).json();
    expect(read).toMatchObject({ title: "מכתב פרידה", body: "אהבתי אתכם תמיד", media: null });
    expect((await inbox(adult)).delivered[0].opened).toBe(true);
    // Another beneficiary or a stranger cannot read it by id (IDOR).
    expect((await req(other, "GET", `/inheritances/${vaultId}/messages/${box.delivered[0].id}`)).statusCode).toBe(404);
    expect((await req(stranger, "GET", `/inheritances/${vaultId}/messages`)).statusCode).toBe(404);
  });

  it("an attached recording is revealed only to its recipient, only with the letter", async () => {
    const mediaOf = async (cookie: string) => ((await req(cookie, "GET", `/inheritances/${vaultId}/media`)).json().items as { id: string }[]).map((m) => m.id);
    expect(await mediaOf(adult)).not.toContain(ids.media);
    expect(await mediaOf(other)).toContain(ids.media);
    const box = await inbox(other);
    const read = (await req(other, "GET", `/inheritances/${vaultId}/messages/${box.delivered[0].id}`)).json();
    expect(read.media).toMatchObject({ id: ids.media, kind: "audio" });
    expect((await req(adult, "GET", `/inheritances/${vaultId}/media/${ids.media}/content`)).statusCode).toBe(404);
  });

  it("shloshim arrives 30 days after death", async () => {
    await setDay("2026-12-01");
    expect((await svc.deliverDue()).delivered).toBe(0);
    await setDay("2026-12-02");
    expect((await svc.deliverDue()).delivered).toBe(1);
    expect((await inbox(adult)).delivered.map((d: { title: string }) => d.title)).toContain("שלושים");
  });

  it("pausing holds deliveries (no email) until resumed", async () => {
    expect((await req(adult, "PUT", `/inheritances/${vaultId}/messages/pause`, { paused: true })).json()).toEqual({ paused: true });
    const erevPesach = nextOccurrence(messageTriggerSchema.parse({ kind: "holiday", holiday: "pesach", repeat: true }), { deathDate: "2026-11-02", releaseDate: "2026-12-03" }, "2026-12-03", true) as string;
    expect(hebrewFromIso(erevPesach)).toMatchObject({ month: 1, day: 14 });
    await setDay(erevPesach);
    const adultMails = () => h.mailer.sent.filter((m) => m.to === "m-adult@example.com").length;
    const mails = adultMails();
    // Also delivers the heir's Hebrew birthday (1 Adar II 5787), which falls before Pesach.
    expect((await svc.deliverDue()).delivered).toBe(2);
    expect(adultMails()).toBe(mails);
    let box = await inbox(adult);
    expect(box).toMatchObject({ paused: true, heldCount: 1 });
    expect(box.delivered.map((d: { title: string }) => d.title)).not.toContain("ערב פסח");

    await req(adult, "PUT", `/inheritances/${vaultId}/messages/pause`, { paused: false });
    box = await inbox(adult);
    expect(box).toMatchObject({ paused: false, heldCount: 0 });
    const pesach = box.delivered.find((d: { title: string }) => d.title === "ערב פסח");
    expect(pesach).toMatchObject({ canStop: true });
  });

  it("a recurring letter can be stopped; life events cannot be 'stopped'", async () => {
    expect((await req(other, "POST", `/inheritances/${vaultId}/messages/${ids.mPesach}/stop`)).statusCode).toBe(404);
    expect((await req(adult, "POST", `/inheritances/${vaultId}/messages/${ids.mPesach}/stop`)).statusCode).toBe(204);
    expect((await req(adult, "POST", `/inheritances/${vaultId}/messages/${ids.mPesach}/stop`)).statusCode).toBe(404);
    expect((await req(adult, "POST", `/inheritances/${vaultId}/messages/${ids.mWedding}/stop`)).statusCode).toBe(404);
    const [r] = await h.db.db
      .select()
      .from(scheduledMessageRecipients)
      .where(and(eq(scheduledMessageRecipients.messageId, ids.mPesach as string), eq(scheduledMessageRecipients.beneficiaryId, ids.adult as string)));
    expect(r).toMatchObject({ status: "stopped", nextDueOn: null });
  });

  it("the recipient opens an 'open when' letter (only their own, only once)", async () => {
    expect((await req(other, "POST", `/inheritances/${vaultId}/messages/${ids.mWedding}/open`)).statusCode).toBe(404);
    expect((await req(adult, "POST", `/inheritances/${vaultId}/messages/${ids.mYahrzeit}/open`)).statusCode).toBe(404);
    const res = await req(adult, "POST", `/inheritances/${vaultId}/messages/${ids.mWedding}/open`);
    expect(res.statusCode).toBe(201);
    const read = (await req(adult, "GET", `/inheritances/${vaultId}/messages/${res.json().deliveryId}`)).json();
    expect(read).toMatchObject({ title: "SECRET-WEDDING-TITLE", body: "מזל טוב" });
    expect((await inbox(adult)).openWhen).toEqual([]);
    expect((await req(adult, "POST", `/inheritances/${vaultId}/messages/${ids.mWedding}/open`)).statusCode).toBe(404);
  });

  it("yahrzeit and the Hebrew birthday arrive on the right Hebrew dates", async () => {
    // Hebrew birthday of the heir (born 1 Adar 5775, a common year) → 1 Adar II 5787 (leap), then 1 Adar 5788.
    const bdDelivery = (await inbox(heir)).delivered.find((d: { title: string }) => d.title === "יום הולדת עברי");
    expect(hebrewFromIso(bdDelivery.occurrenceOn)).toEqual({ year: 5787, month: 13, day: 1 });
    const [bd] = await h.db.db
      .select()
      .from(scheduledMessageRecipients)
      .where(eq(scheduledMessageRecipients.messageId, ids.mBirthday as string));
    expect(hebrewFromIso(bd?.nextDueOn as string)).toEqual({ year: 5788, month: 12, day: 1 });
    const [yz] = await h.db.db.select().from(scheduledMessageRecipients).where(eq(scheduledMessageRecipients.messageId, ids.mYahrzeit as string));
    const death = hebrewFromIso("2026-11-02");
    expect(hebrewFromIso(yz?.nextDueOn as string)).toEqual({ year: death.year + 1, month: death.month, day: death.day });
    await setDay(yz?.nextDueOn as string);
    expect((await svc.deliverDue()).delivered).toBeGreaterThanOrEqual(1);
    const [after] = await h.db.db.select().from(scheduledMessageRecipients).where(eq(scheduledMessageRecipients.messageId, ids.mYahrzeit as string));
    expect(hebrewFromIso(after?.nextDueOn as string)).toMatchObject({ year: death.year + 2, month: death.month, day: death.day });
  });

  it("the vault is locked for the legator after release", async () => {
    expect((await msg({ beneficiaryIds: [ids.adult], trigger: { kind: "on_release" } })).statusCode).toBe(409);
  });

  it("minor protection: a beneficiary under 18 cannot talk with the persona", async () => {
    await req(legator, "POST", "/me/consents", { purpose: "ai_processing", granted: true });
    const ov = (await req(heir, "GET", `/persona/vaults/${vaultId}`)).json();
    expect(ov).toMatchObject({ minor: true, available: false });
    const start = await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, {});
    expect(start.statusCode).toBe(403);
    expect(start.json().error.code).toBe("persona_minor_blocked");
    // An adult beneficiary can.
    expect((await req(adult, "POST", `/persona/vaults/${vaultId}/sessions`, {})).statusCode).toBe(201);
    // The heir still receives written letters.
    expect((await inbox(heir)).delivered.length).toBeGreaterThanOrEqual(1);
  });
});
