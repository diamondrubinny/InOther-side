import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, legacyVaults, personaSessions, personaSettings } from "../src/db/schema.js";
import { createHarness, nextIp, signUpAndLogin, tokenFromMail, type Harness } from "./harness.js";

let h: Harness;
let legator: string;
let heir: string;
let otherHeir: string;
let stranger: string;
let vaultId: string;
const ids: Record<string, string> = {};

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string | undefined, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });

interface Ev { type: string; [k: string]: unknown }
async function say(cookie: string, sessionId: string, text: string): Promise<{ status: number; events: Ev[]; raw: string }> {
  const res = await req(cookie, "POST", `/persona/sessions/${sessionId}/messages`, { text });
  const events = res.body
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as Ev);
  return { status: res.statusCode, events, raw: res.body };
}
const replyText = (events: Ev[]) => events.filter((e) => e.type === "text").map((e) => e.delta).join("");

function fakeMp3(extra: string): Buffer {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([id3, Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(400), Buffer.from(extra), Buffer.alloc(2000, 1)]);
}
async function upload(cookie: string, kind: string, type: string, data: Buffer, storyId?: string): Promise<string> {
  const c = (await req(cookie, "POST", "/vault/media", { kind, contentType: type, sizeBytes: data.length, ...(storyId ? { storyId } : {}) })).json();
  await h.request({ method: "PUT", url: c.uploadUrl, cookie, rawBody: data, headers: { "content-type": type }, ip: nextIp() });
  return c.id;
}
const consent = (cookie: string, purpose: string, granted = true) => req(cookie, "POST", "/me/consents", { purpose, granted });

beforeAll(async () => {
  h = await createHarness();
  legator = await signUpAndLogin(h, "p-legator@example.com");
  heir = await signUpAndLogin(h, "p-heir@example.com");
  otherHeir = await signUpAndLogin(h, "p-other@example.com");
  stranger = await signUpAndLogin(h, "p-stranger@example.com");
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  await req(legator, "PUT", "/vault/answers/humor.sayings", { text: "תמיד אמרתי: יהיה בסדר, העיקר הבריאות" });
  await req(legator, "PUT", "/vault/answers/childhood.home", { text: "גדלתי בחיפה, בבית עם עץ לימון גדול" });
  ids.heirB = (await req(legator, "POST", "/vault/beneficiaries", { name: "Heir", relation: "child", email: "p-heir@example.com" })).json().id;
  ids.otherB = (await req(legator, "POST", "/vault/beneficiaries", { name: "Other", relation: "child", email: "p-other@example.com" })).json().id;
  const story = (b: object) => req(legator, "POST", "/vault/stories", { audience: "all", releaseRule: "on_release", delivery: "persona_tells", ...b });
  ids.secret = (await story({ title: "הסוד של הצוללת", body: "בצוללת בשנת שבעים ושלוש ראיתי לווייתן כחול", audience: "specific", beneficiaryIds: [ids.otherB] })).json().id;
  ids.original = (await story({ title: "שיר החתונה", body: "השיר ששרתי בחתונה של סבתא", delivery: "original_only" })).json().id;
  ids.weddingAudio = await upload(legator, "audio", "audio/mpeg", fakeMp3("wedding-song"), ids.original);
});
afterAll(async () => {
  await h.close();
});

describe("consent gating", () => {
  it("no persona without the legator's explicit AI consent", async () => {
    const res = await req(legator, "POST", `/persona/vaults/${vaultId}/sessions`, {});
    expect(res.json().error.code).toBe("persona_not_consented");
    await consent(legator, "ai_processing");
    expect((await req(legator, "POST", `/persona/vaults/${vaultId}/sessions`, {})).statusCode).toBe(201);
  });

  it("strangers and not-yet-released beneficiaries get 404", async () => {
    expect((await req(stranger, "GET", `/persona/vaults/${vaultId}`)).statusCode).toBe(404);
    expect((await req(stranger, "POST", `/persona/vaults/${vaultId}/sessions`, {})).statusCode).toBe(404);
  });
});

describe("conversation (legator preview)", () => {
  let sid: string;
  beforeAll(async () => {
    sid = (await req(legator, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().sessionId;
  });

  it("streams a reply grounded only in the vault material", async () => {
    const { status, events } = await say(legator, sid, "איפה גדלת? היה לכם עץ?");
    expect(status).toBe(200);
    expect(replyText(events)).toContain("עץ לימון");
    expect(events.some((e) => e.type === "segment")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("admits not knowing instead of inventing", async () => {
    const { events } = await say(legator, sid, "מה דעתך על כדורגל?");
    expect(replyText(events)).toContain("לא זוכר");
  });

  it("plays 'original only' stories as the original recording, not a retelling", async () => {
    const { events } = await say(legator, sid, "ספר לי על השיר בחתונה של סבתא");
    const play = events.find((e) => e.type === "play_story");
    expect(play).toMatchObject({ storyId: ids.original, mediaId: ids.weddingAudio, text: null });
    expect(replyText(events)).not.toContain("PLAY_STORY");
  });

  it("speaks only segments it generated; others' sessions are invisible", async () => {
    const { events } = await say(legator, sid, "מה היית תמיד אומר?");
    const seg = events.find((e) => e.type === "segment") as { id: string } | undefined;
    expect(seg).toBeTruthy();
    const audio = await req(legator, "GET", `/persona/sessions/${sid}/segments/${seg!.id}/audio`);
    expect(audio.statusCode).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/wav");
    expect(audio.headers["x-ai-generated"]).toBe("true");
    expect(audio.rawPayload.subarray(0, 4).toString()).toBe("RIFF");
    expect((await req(legator, "GET", `/persona/sessions/${sid}/segments/${crypto.randomUUID()}/audio`)).statusCode).toBe(404);
    expect((await req(stranger, "GET", `/persona/sessions/${sid}/segments/${seg!.id}/audio`)).statusCode).toBe(404);
    expect((await say(stranger, sid, "hi")).status).toBe(404);
  });

  it("breaks character on crisis signals, in any supported language, and logs no content", async () => {
    for (const text of ["אני לא רוצה לחיות בלעדיך", "I want to die and join you there", "хочу умереть"]) {
      const { events } = await say(legator, sid, text);
      expect(events[0]).toMatchObject({ type: "safety", level: "crisis" });
      expect(String(events[0]?.message)).toContain("1201");
      expect(events.some((e) => e.type === "text")).toBe(false);
    }
    const [s] = await h.db.db.select().from(personaSessions).where(eq(personaSessions.id, sid));
    expect(s?.safetyFlag).toBe(true);
    const logs = JSON.stringify(await h.db.db.select().from(auditLog));
    expect(logs).not.toContain("לחיות");
    expect(logs).toContain("persona.safety_event");
  });

  it("enforces the session time limit", async () => {
    h.clock.advanceMinutes(31);
    const { events } = await say(legator, sid, "עוד שאלה");
    expect(events[0]).toMatchObject({ type: "limit", reason: "time_limit" });
    h.clock.advanceMinutes(-31);
  });
});

describe("cloned voice", () => {
  it("requires the voice-cloning consent and the legator's own recordings; withdrawing deletes it", async () => {
    expect((await req(legator, "POST", "/persona/settings/voice")).json().error.code).toBe("voice_not_consented");
    await consent(legator, "voice_cloning");
    const res = await req(legator, "POST", "/persona/settings/voice");
    expect(res.json().voiceStatus).toBe("ready");
    const [s] = await h.db.db.select().from(personaSettings).where(eq(personaSettings.vaultId, vaultId));
    expect(s?.voiceRefEnc?.toString("utf8")).not.toContain("mock-voice"); // stored encrypted
    expect((await req(legator, "GET", `/persona/vaults/${vaultId}`)).json().voice).toBe("cloned");

    await consent(legator, "voice_cloning", false);
    expect((await req(legator, "GET", "/persona/settings")).json().voiceStatus).toBe("none");
    expect((await req(legator, "GET", `/persona/vaults/${vaultId}`)).json().voice).toBe("standard");
    await consent(legator, "voice_cloning");
    await req(legator, "POST", "/persona/settings/voice");
  });
});

describe("portrait", () => {
  it("is served only with avatar consent, to allowed viewers", async () => {
    const png = await sharp({ create: { width: 40, height: 50, channels: 3, background: "gray" } }).png().toBuffer();
    ids.portrait = await upload(legator, "image", "image/png", png);
    expect((await req(legator, "PATCH", "/persona/settings", { portraitMediaId: ids.weddingAudio })).json().error.code).toBe("invalid_portrait");
    await req(legator, "PATCH", "/persona/settings", { portraitMediaId: ids.portrait, mouthX: 500, mouthY: 700 });
    expect((await req(legator, "GET", `/persona/vaults/${vaultId}/portrait`)).statusCode).toBe(404); // no avatar consent yet
    await consent(legator, "avatar_creation");
    const img = await req(legator, "GET", `/persona/vaults/${vaultId}/portrait`);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect((await req(legator, "GET", `/persona/vaults/${vaultId}`)).json().portrait).toEqual({ mouthX: 500, mouthY: 700 });
  });
});

describe("beneficiaries after release", () => {
  beforeAll(async () => {
    await req(legator, "POST", `/vault/beneficiaries/${ids.heirB}/invite`);
    await req(heir, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, "p-heir@example.com") });
    await req(legator, "POST", `/vault/beneficiaries/${ids.otherB}/invite`);
    await req(otherHeir, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, "p-other@example.com") });
    await req(legator, "PATCH", "/persona/settings", { sessionsLimit: 2 });
    await h.db.db.update(legacyVaults).set({ status: "released" }).where(eq(legacyVaults.id, vaultId));
  });

  it("the persona only knows what this beneficiary may see", async () => {
    const sHeir = (await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().sessionId;
    expect(replyText((await say(heir, sHeir, "ספר על הצוללת והלווייתן")).events)).toContain("לא זוכר");
    const sOther = (await req(otherHeir, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().sessionId;
    expect(replyText((await say(otherHeir, sOther, "ספר על הצוללת והלווייתן")).events)).toContain("לווייתן כחול");
  });

  it("is a bounded journey: farewell needs a prior session and closes the journey", async () => {
    const overview = (await req(heir, "GET", `/persona/vaults/${vaultId}`)).json();
    expect(overview).toMatchObject({ mode: "beneficiary", available: true, voice: "cloned", journey: { sessionsUsed: 1, complete: false } });
    const farewell = (await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, { kind: "farewell" })).json();
    expect(farewell.kind).toBe("farewell");
    expect((await say(heir, farewell.sessionId, "רציתי להגיד תודה על הכל")).status).toBe(200);
    await req(heir, "POST", `/persona/sessions/${farewell.sessionId}/end`);
    const after = await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, {});
    expect(after.json().error.code).toBe("journey_complete");
    expect((await req(heir, "GET", `/persona/vaults/${vaultId}`)).json().journey).toMatchObject({ farewellDone: true, complete: true });
  });

  it("stops entirely when the legator's AI consent is withdrawn", async () => {
    await consent(legator, "ai_processing", false);
    expect((await req(otherHeir, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().error.code).toBe("persona_not_consented");
    expect((await req(otherHeir, "GET", `/persona/vaults/${vaultId}`)).json().available).toBe(false);
  });
});

describe("configuration", () => {
  it("refuses mock AI providers in production", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://x@localhost/x",
        WEB_ORIGIN: "https://app.example.com",
        MASTER_KEY_BASE64: Buffer.alloc(32, 1).toString("base64"),
        HMAC_SECRET_BASE64: Buffer.alloc(32, 2).toString("base64"),
        MAIL_TRANSPORT: "smtp",
        SMTP_URL: "smtp://x",
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "b",
        SCANNER: "clamd",
        LLM_PROVIDER: "mock",
      }),
    ).toThrow(/mock AI providers/);
  });
});
