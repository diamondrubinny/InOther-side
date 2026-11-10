import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legacyVaults, releaseRequests, timelineEvents } from "../src/db/schema.js";
import { createHarness, nextIp, signUpAndLogin, tokenFromMail, type Harness } from "./harness.js";

let h: Harness;
let legator: string;
let heir: string;
let other: string;
let stranger: string;
let otherLegator: string;
let vaultId: string;
const ids: Record<string, string> = {};

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string | undefined, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });
const ev = (b: object) => req(legator, "POST", "/vault/timeline", { title: "t", date: "1990", ...b });
const mp3 = (n: number) => Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2400, n)]);
async function upload(cookie: string, n: number): Promise<string> {
  const data = mp3(n);
  const c = (await req(cookie, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: data.length })).json();
  await h.request({ method: "PUT", url: c.uploadUrl, cookie, rawBody: data, headers: { "content-type": "audio/mpeg" }, ip: nextIp() });
  return c.id;
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.now = new Date("2026-11-10T08:00:00Z");
  legator = await signUpAndLogin(h, "t-legator@example.com");
  heir = await signUpAndLogin(h, "t-heir@example.com");
  other = await signUpAndLogin(h, "t-other@example.com");
  stranger = await signUpAndLogin(h, "t-stranger@example.com");
  otherLegator = await signUpAndLogin(h, "t-other-legator@example.com");
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  await req(otherLegator, "POST", "/vault", { consentToProcessing: true });
  ids.heir = (await req(legator, "POST", "/vault/beneficiaries", { name: "Heir", relation: "child", email: "t-heir@example.com" })).json().id;
  ids.other = (await req(legator, "POST", "/vault/beneficiaries", { name: "Other", relation: "child", email: "t-other@example.com" })).json().id;
  const story = (b: object) => req(legator, "POST", "/vault/stories", { body: "x", audience: "all", releaseRule: "on_release", delivery: "original_only", ...b });
  ids.sAll = (await story({ title: "all" })).json().id;
  ids.sOther = (await story({ title: "other only", audience: "specific", beneficiaryIds: [ids.other] })).json().id;
  ids.media = await upload(legator, 1);
  ids.reserved = await upload(legator, 2);
  ids.foreignMedia = await upload(otherLegator, 3);
  await req(legator, "POST", "/vault/messages", { title: "m", body: "x", beneficiaryIds: [ids.heir], trigger: { kind: "life_event", event: "wedding" }, mediaId: ids.reserved });
  for (const [b, cookie, email] of [[ids.heir, heir, "t-heir@example.com"], [ids.other, other, "t-other@example.com"]] as const) {
    await req(legator, "POST", `/vault/beneficiaries/${b}/invite`);
    await req(cookie, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, email) });
  }
});
afterAll(async () => {
  await h.close();
});

describe("life timeline", () => {
  it("validates partial dates and links", async () => {
    for (const date of ["61", "1961-13", "1961-02-30", "1961-00", "1799", "1961-3", "2027", "2026-12", "2026-11-11"]) {
      expect((await ev({ date })).statusCode, date).toBe(400);
    }
    expect((await ev({ date: "2026-12" })).json().error.code).toBe("date_in_future");
    // Same year / month / day as today is allowed at that precision.
    for (const date of ["2026", "2026-11", "2026-11-10", "2024-02-29"]) expect((await ev({ date })).statusCode, date).toBe(201);
    expect((await ev({ storyId: "00000000-0000-4000-8000-000000000000" })).json().error.code).toBe("unknown_story");
    expect((await ev({ mediaId: ids.foreignMedia })).json().error.code).toBe("invalid_media"); // another vault's file
    expect((await ev({ title: "" })).statusCode).toBe(400);
  });

  it("stores encrypted and returns events in chronological order", async () => {
    for (const e of (await req(legator, "GET", "/vault/timeline")).json().items) await req(legator, "DELETE", `/vault/timeline/${e.id}`);
    ids.wedding = (await ev({ title: "החתונה", date: "1961-03-07", description: "בחיפה", storyId: ids.sOther, mediaId: ids.media })).json().id;
    ids.born = (await ev({ title: "נולדתי", date: "1938" })).json().id;
    ids.aliyah = (await ev({ title: "עלינו לארץ", date: "1949-05", storyId: ids.sAll, mediaId: ids.reserved })).json().id;
    await ev({ title: "תחילת 1961", date: "1961" });
    const list = (await req(legator, "GET", "/vault/timeline")).json().items;
    expect(list.map((e: { title: string }) => e.title)).toEqual(["נולדתי", "עלינו לארץ", "תחילת 1961", "החתונה"]);
    expect(list[3]).toEqual({ id: ids.wedding, title: "החתונה", date: "1961-03-07", description: "בחיפה", storyId: ids.sOther, mediaId: ids.media });
    const [row] = await h.db.db.select().from(timelineEvents).where(eq(timelineEvents.id, ids.wedding as string));
    const raw = Buffer.concat([row!.titleEnc, row!.dateEnc, row!.descriptionEnc!]).toString("latin1");
    expect(raw).not.toContain("1961");
    expect(Buffer.concat([row!.titleEnc]).toString("utf8")).not.toContain("החתונה");
  });

  it("edit and delete are limited to the owner (IDOR)", async () => {
    const body = { title: "נולדתי בירושלים", date: "1938-01" };
    expect((await req(otherLegator, "PUT", `/vault/timeline/${ids.born}`, body)).statusCode).toBe(404);
    expect((await req(otherLegator, "DELETE", `/vault/timeline/${ids.born}`)).statusCode).toBe(404);
    expect((await req(stranger, "GET", "/vault/timeline")).statusCode).toBe(404);
    expect((await req(legator, "PUT", `/vault/timeline/${ids.born}`, body)).json()).toMatchObject(body);
    expect((await req(otherLegator, "GET", "/vault/timeline")).json().items).toEqual([]);
  });

  it("appears in the legator's book", async () => {
    const book = (await req(legator, "GET", "/vault/book")).json();
    expect(book.timeline.map((e: { date: string }) => e.date)).toEqual(["1938-01", "1949-05", "1961", "1961-03-07"]);
  });

  it("beneficiaries see every event, but links only to what they may see", async () => {
    expect((await req(heir, "GET", `/inheritances/${vaultId}/timeline`)).statusCode).toBe(404); // not released yet
    await h.db.db.insert(releaseRequests).values({ vaultId, status: "released", dateOfDeath: "2026-10-01", cancelTokenHash: Buffer.alloc(32), releasedAt: h.clock.now });
    await h.db.db.update(legacyVaults).set({ status: "released" }).where(eq(legacyVaults.id, vaultId));

    const mine = (await req(heir, "GET", `/inheritances/${vaultId}/timeline`)).json().items;
    expect(mine.map((e: { title: string }) => e.title)).toEqual(["נולדתי בירושלים", "עלינו לארץ", "תחילת 1961", "החתונה"]);
    const byId = (list: { id: string }[], id: string) => list.find((e) => e.id === id);
    // Story reserved for the other heir: link hidden. Open media: link kept.
    expect(byId(mine, ids.wedding as string)).toMatchObject({ storyId: null, mediaId: ids.media, description: "בחיפה" });
    // Media reserved for an undelivered letter: link hidden. Story for all: kept.
    expect(byId(mine, ids.aliyah as string)).toMatchObject({ storyId: ids.sAll, mediaId: null });

    const theirs = (await req(other, "GET", `/inheritances/${vaultId}/timeline`)).json().items;
    expect(byId(theirs, ids.wedding as string)).toMatchObject({ storyId: ids.sOther, mediaId: ids.media });
    expect((await req(heir, "GET", `/inheritances/${vaultId}/book`)).json().timeline).toEqual(mine);
    expect((await req(stranger, "GET", `/inheritances/${vaultId}/timeline`)).statusCode).toBe(404);
    // Locked after release.
    expect((await ev({})).statusCode).toBe(409);
  });
});
