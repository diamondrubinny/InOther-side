import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legacyVaults, mediaTranscripts, releaseRequests } from "../src/db/schema.js";
import { VaultCipher } from "../src/lib/crypto/keys.js";
import { VaultService } from "../src/modules/vault/vault.service.js";
import { createHarness, nextIp, signUpAndLogin, tokenFromMail, type Harness } from "./harness.js";

let h: Harness;
let legator: string;
let heir: string;
let other: string;
let stranger: string;
let vaultId: string;
const ids: Record<string, string> = {};

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string | undefined, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });
const mp3 = (n: number) => Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2400, n)]);
async function upload(label: string, n: number): Promise<string> {
  const data = mp3(n);
  const c = (await req(legator, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: data.length, label })).json();
  await h.request({ method: "PUT", url: c.uploadUrl, cookie: legator, rawBody: data, headers: { "content-type": "audio/mpeg" }, ip: nextIp() });
  return c.id;
}

beforeAll(async () => {
  h = await createHarness();
  legator = await signUpAndLogin(h, "b-legator@example.com");
  heir = await signUpAndLogin(h, "b-heir@example.com");
  other = await signUpAndLogin(h, "b-other@example.com");
  stranger = await signUpAndLogin(h, "b-stranger@example.com");
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  await req(legator, "PATCH", "/vault", { openingMessage: "לילדים שלי" });
  await req(legator, "PUT", "/vault/answers/childhood.home", { text: "בית עם עץ לימון" });
  ids.heir = (await req(legator, "POST", "/vault/beneficiaries", { name: "Heir", relation: "child", email: "b-heir@example.com" })).json().id;
  ids.other = (await req(legator, "POST", "/vault/beneficiaries", { name: "Other", relation: "child", email: "b-other@example.com" })).json().id;
  const story = (b: object) => req(legator, "POST", "/vault/stories", { body: "גוף הסיפור", audience: "all", releaseRule: "on_release", delivery: "original_only", ...b });
  await story({ title: "לכולם" });
  await story({ title: "רק ל-other", audience: "specific", beneficiaryIds: [ids.other] });
  ids.open = await upload("שיר ערש", 1);
  ids.reserved = await upload("ליום החתונה", 2);
  await req(legator, "POST", "/vault/messages", { title: "חתונה", body: "x", beneficiaryIds: [ids.heir], trigger: { kind: "life_event", event: "wedding" }, mediaId: ids.reserved });
  // A finished transcript for the open recording (the transcription pipeline has its own tests).
  const [vault] = await h.db.db.select().from(legacyVaults).where(eq(legacyVaults.id, vaultId));
  const cipher = new VaultCipher(await new VaultService(h.ctx).dekFor(vault!));
  await h.db.db
    .insert(mediaTranscripts)
    .values({ mediaId: ids.open, vaultId, status: "done", textEnc: cipher.encrypt("נומי נומי ילדתי", `media.transcript:${ids.open}`) })
    .onConflictDoUpdate({ target: mediaTranscripts.mediaId, set: { status: "done", textEnc: cipher.encrypt("נומי נומי ילדתי", `media.transcript:${ids.open}`) } });
  for (const [b, cookie, email] of [[ids.heir, heir, "b-heir@example.com"], [ids.other, other, "b-other@example.com"]] as const) {
    await req(legator, "POST", `/vault/beneficiaries/${b}/invite`);
    await req(cookie, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, email) });
  }
});
afterAll(async () => {
  await h.close();
});

describe("legacy book", () => {
  it("the legator previews everything, grouped by topic", async () => {
    const res = await req(legator, "GET", "/vault/book");
    expect(res.statusCode).toBe(200);
    const book = res.json();
    expect(book).toMatchObject({ legatorName: "משתמש בדיקה", openingMessage: "לילדים שלי" });
    expect(book.chapters).toEqual([{ id: "childhood", title: "ילדות", entries: [{ question: expect.any(String), answer: "בית עם עץ לימון" }] }]);
    expect(book.stories.map((s: { title: string }) => s.title)).toEqual(["לכולם", "רק ל-other"]);
    expect(book.recordings).toEqual([
      { id: ids.open, kind: "audio", label: "שיר ערש", transcript: "נומי נומי ילדתי" },
      { id: ids.reserved, kind: "audio", label: "ליום החתונה", transcript: null },
    ]);
    // Localized.
    expect((await req(legator, "GET", "/vault/book?locale=en")).json().chapters[0].title).toBe("Childhood");
  });

  it("is not available to beneficiaries before release, nor to strangers", async () => {
    expect((await req(heir, "GET", `/inheritances/${vaultId}/book`)).statusCode).toBe(404);
    expect((await req(stranger, "GET", `/inheritances/${vaultId}/book`)).statusCode).toBe(404);
    expect((await req(stranger, "GET", "/vault/book")).statusCode).toBe(404);
    expect((await req(undefined, "GET", "/vault/book")).statusCode).toBe(401);
  });

  it("after release, a beneficiary's book holds only what they may see", async () => {
    await h.db.db.insert(releaseRequests).values({ vaultId, status: "released", dateOfDeath: "2026-10-01", cancelTokenHash: Buffer.alloc(32), releasedAt: h.clock.now });
    await h.db.db.update(legacyVaults).set({ status: "released" }).where(eq(legacyVaults.id, vaultId));
    const book = (await req(heir, "GET", `/inheritances/${vaultId}/book`)).json();
    expect(book.stories.map((s: { title: string }) => s.title)).toEqual(["לכולם"]); // not the other heir's story
    // The recording reserved for the wedding letter is hidden until that letter is delivered.
    expect(book.recordings.map((r: { id: string }) => r.id)).toEqual([ids.open]);
    expect(JSON.stringify(book)).not.toContain("ליום החתונה");
    expect(book.chapters[0].entries[0].answer).toBe("בית עם עץ לימון");

    const theirs = (await req(other, "GET", `/inheritances/${vaultId}/book`)).json();
    expect(theirs.stories.map((s: { title: string }) => s.title)).toEqual(["לכולם", "רק ל-other"]);
    expect(theirs.recordings.map((r: { id: string }) => r.id)).toEqual([ids.open]);
    expect((await req(stranger, "GET", `/inheritances/${vaultId}/book`)).statusCode).toBe(404);
  });
});
