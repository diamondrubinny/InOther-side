import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interviewEntries } from "../src/db/schema.js";
import { createHarness, nextIp, signUpAndLogin, type Harness } from "./harness.js";

let h: Harness;
let legator: string;
let stranger: string;
type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });

beforeAll(async () => {
  h = await createHarness();
  legator = await signUpAndLogin(h, "iv-legator@example.com");
  stranger = await signUpAndLogin(h, "iv-stranger@example.com");
  await req(legator, "POST", "/vault", { consentToProcessing: true });
  await req(stranger, "POST", "/vault", { consentToProcessing: true });
});
afterAll(async () => {
  await h.close();
});

describe("AI interviewer", () => {
  it("requires AI consent", async () => {
    expect((await req(legator, "POST", "/interview/start", {})).json().error.code).toBe("persona_not_consented");
    await req(legator, "POST", "/me/consents", { purpose: "ai_processing", granted: true });
  });

  it("opens with an unanswered catalog question, then asks follow-ups that build on the answer", async () => {
    const start = (await req(legator, "POST", "/interview/start", { topicId: "childhood" })).json();
    expect(start.question).toBe("תאר/י את הבית שגדלת בו. מה רואים, שומעים ומריחים שם?");
    const a1 = (await req(legator, "POST", "/interview/answer", { sittingId: start.sittingId, topicId: "childhood", question: start.question, answer: "גדלתי בקיבוץ ליד הכנרת, עם ריח של פרדסים" })).json();
    expect(a1.next).toContain("גדלתי");
    expect(a1.support).toBeNull();
    const a2 = (await req(legator, "POST", "/interview/answer", { sittingId: start.sittingId, topicId: "childhood", question: a1.next, answer: "הייתי מטפס על עץ התות עם אחי" })).json();
    expect(a2.next).not.toBe(a1.next);
    // Stored encrypted.
    const raw = JSON.stringify(await h.db.db.select().from(interviewEntries), (_k, v) => (v?.type === "Buffer" ? Buffer.from(v.data).toString("utf8") : v));
    expect(raw).not.toContain("כנרת");
  });

  it("feeds the persona: interview answers become conversation material", async () => {
    const sid = (await req(legator, "POST", `/persona/vaults/${(await req(legator, "GET", "/vault")).json().id}/sessions`, {})).json().sessionId;
    const res = await req(legator, "POST", `/persona/sessions/${sid}/messages`, { text: "ספר לי על ריח פרדסים" });
    expect(res.body).toContain("פרדסים");
  });

  it("offers support when an answer shows distress", async () => {
    const start = (await req(legator, "POST", "/interview/start", {})).json();
    const res = (await req(legator, "POST", "/interview/answer", { sittingId: start.sittingId, topicId: null, question: start.question, answer: "לפעמים אני לא רוצה לחיות עם הכאב הזה" })).json();
    expect(res.support).toContain("1201");
  });

  it("lists and deletes only the legator's own entries", async () => {
    const items = (await req(legator, "GET", "/interview/entries")).json().items;
    expect(items.length).toBe(3);
    expect((await req(stranger, "DELETE", `/interview/entries/${items[0].id}`)).statusCode).toBe(404);
    expect((await req(legator, "DELETE", `/interview/entries/${items[0].id}`)).statusCode).toBe(204);
    expect((await req(legator, "GET", "/interview/entries")).json().items.length).toBe(2);
  });
});
