import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legacyVaults, personaMemories, personaProfiles, releaseRequests } from "../src/db/schema.js";
import { createHarness, nextIp, signUpAndLogin, tokenFromMail, type Harness } from "./harness.js";

let h: Harness;
let legator: string;
let heir: string;
let vaultId: string;

type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });
async function say(cookie: string, sid: string, text: string): Promise<string> {
  const res = await req(cookie, "POST", `/persona/sessions/${sid}/messages`, { text });
  return res.body
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; delta?: string })
    .filter((e) => e.type === "text")
    .map((e) => e.delta)
    .join("");
}

beforeAll(async () => {
  h = await createHarness();
  legator = await signUpAndLogin(h, "card-legator@example.com");
  heir = await signUpAndLogin(h, "card-heir@example.com");
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  await req(legator, "POST", "/me/consents", { purpose: "ai_processing", granted: true });
  await req(legator, "PUT", "/vault/answers/humor.sayings", { text: "יהיה בסדר, העיקר הבריאות" });
  await req(legator, "PUT", "/vault/answers/values.core", { text: "משפחה, יושר, חסד" });
  await req(legator, "PUT", "/vault/answers/humor.nicknames", { text: "את נועה תמיד קראתי בובה" });
  const ben = (await req(legator, "POST", "/vault/beneficiaries", { name: "נועה", relation: "grandchild", email: "card-heir@example.com" })).json();
  await req(legator, "POST", `/vault/beneficiaries/${ben.id}/invite`);
  await req(heir, "POST", "/invitations/accept", { token: tokenFromMail(h.mailer, "card-heir@example.com") });
});
afterAll(async () => {
  await h.close();
});

describe("personality card", () => {
  it("is generated from the legator's own words as an encrypted draft", async () => {
    const res = await req(legator, "POST", "/persona/profile/generate");
    expect(res.statusCode).toBe(200);
    const { status, card } = res.json();
    expect(status).toBe("draft");
    expect(card.speechPatterns).toContain("יהיה בסדר");
    expect(card.values).toEqual(expect.arrayContaining(["משפחה", "יושר", "חסד"]));
    expect(card.relationships).toEqual([{ name: "נועה", relation: "grandchild", howIAddressThem: "בובה" }]);
    const [row] = await h.db.db.select().from(personaProfiles).where(eq(personaProfiles.vaultId, vaultId));
    expect(row?.cardEnc.toString("utf8")).not.toContain("יהיה בסדר");
  });

  it("keeps the persona in character on topics outside the material (preview uses the draft)", async () => {
    const sid = (await req(legator, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().sessionId;
    const reply = await say(legator, sid, "מה דעתך על מחשבים קוונטיים?");
    expect(reply).toContain("כמו שתמיד אמרתי");
    expect(reply).not.toContain("עובדה");
  });

  it("'that's not like me' corrections become binding and survive regeneration", async () => {
    const res = await req(legator, "POST", "/persona/feedback", { reply: "שלום יקירי", verdict: "not_like_me", correction: "אני אף פעם לא אומר 'יקירי'" });
    expect(res.json().card.corrections).toContain("אני אף פעם לא אומר 'יקירי'");
    const regenerated = (await req(legator, "POST", "/persona/profile/generate")).json();
    expect(regenerated.card.corrections).toContain("אני אף פעם לא אומר 'יקירי'");
  });

  it("beneficiaries get the card only after the legator approves it", async () => {
    await h.db.db.update(legacyVaults).set({ status: "released" }).where(eq(legacyVaults.id, vaultId));
    await h.db.db.insert(releaseRequests).values({ vaultId, status: "released", dateOfDeath: "2026-09-01", cancelTokenHash: Buffer.alloc(32) });

    let sid = (await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().sessionId;
    let reply = await say(heir, sid, "מה דעתך על הבחירות?");
    expect(reply).not.toContain("כמו שתמיד אמרתי"); // draft card not used
    expect(reply.startsWith("בובה")).toBe(false);

    const profile = (await req(legator, "GET", "/persona/profile")).json();
    expect((await req(legator, "PUT", "/persona/profile", { card: profile.card, approve: true })).json().status).toBe("approved");

    sid = (await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().sessionId;
    reply = await say(heir, sid, "מה דעתך על הבחירות?");
    expect(reply.startsWith("בובה, ")).toBe(true); // addressed the way the legator addressed her
    expect(reply).toContain("כמו שתמיד אמרתי");
  });
});

describe("opt-in memory across conversations", () => {
  it("remembers only when asked, stores an encrypted summary, and forgets on request", async () => {
    await req(legator, "PATCH", "/persona/settings", { sessionsLimit: 20 });
    // Without opt-in nothing is stored.
    let sid = (await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, { remember: false })).json().sessionId;
    await say(heir, sid, "התחלתי ללמוד רפואה");
    await req(heir, "POST", `/persona/sessions/${sid}/end`);
    expect(await h.db.db.select().from(personaMemories)).toHaveLength(0);

    sid = (await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, { remember: true })).json().sessionId;
    await say(heir, sid, "התחלתי ללמוד רפואה בירושלים");
    await req(heir, "POST", `/persona/sessions/${sid}/end`);
    const rows = await h.db.db.select().from(personaMemories);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summaryEnc.toString("utf8")).not.toContain("רפואה");

    sid = (await req(heir, "POST", `/persona/vaults/${vaultId}/sessions`, { remember: true })).json().sessionId;
    expect(await say(heir, sid, "אתה זוכר מה סיפרתי לך בפעם הקודמת?")).toContain("רפואה בירושלים");
    await req(heir, "POST", `/persona/sessions/${sid}/end`);

    expect((await req(heir, "DELETE", `/persona/vaults/${vaultId}/memory`)).statusCode).toBe(204);
    expect(await h.db.db.select().from(personaMemories)).toHaveLength(0);
    expect((await req(heir, "GET", `/persona/vaults/${vaultId}`)).json().hasMemory).toBe(false);
  });
});
