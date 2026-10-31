import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { legacyVaults, sealedStories, vaultBeneficiaries } from "../src/db/schema.js";
import { createHarness, nextIp, reauth, signUpAndLogin, type Harness } from "./harness.js";

let h: Harness;
let alice: string;
let bob: string;

const story = {
  title: "הסיפור שלא סיפרתי",
  body: "בקיץ של 1974, ליד הים, קרה משהו שאף אחד לא יודע...",
  audience: "all",
  releaseRule: "on_release",
  delivery: "original_only",
};

beforeAll(async () => {
  h = await createHarness();
  alice = await signUpAndLogin(h, "alice@example.com");
  bob = await signUpAndLogin(h, "bob@example.com");
});
afterAll(async () => {
  await h.close();
});

const req = (cookie: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) =>
  h.request({ method, url, cookie, body, ip: nextIp() });

describe("vault lifecycle", () => {
  it("requires authentication and explicit consent", async () => {
    expect((await h.request({ method: "GET", url: "/vault" })).statusCode).toBe(401);
    const noConsent = await req(alice, "POST", "/vault", {});
    expect(noConsent.statusCode).toBe(400);
    const created = await req(alice, "POST", "/vault", { consentToProcessing: true });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "building", releaseWaitDays: 14, counts: { stories: 0 } });
    expect((await req(alice, "POST", "/vault", { consentToProcessing: true })).statusCode).toBe(409);
  });

  it("updates settings and validates ranges", async () => {
    const bad = await req(alice, "PATCH", "/vault", { releaseWaitDays: 1 });
    expect(bad.statusCode).toBe(400);
    const ok = await req(alice, "PATCH", "/vault", { releaseWaitDays: 21, openingMessage: "ילדים שלי, אם אתם שומעים את זה..." });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ releaseWaitDays: 21, openingMessage: "ילדים שלי, אם אתם שומעים את זה..." });
  });

  it("returns 404 (not 403) for a user without a vault", async () => {
    expect((await req(bob, "GET", "/vault")).statusCode).toBe(404);
    expect((await req(bob, "GET", "/vault/stories")).statusCode).toBe(404);
  });
});

describe("encryption at rest", () => {
  it("stores names, emails and story content only as ciphertext", async () => {
    await req(alice, "POST", "/vault/beneficiaries", { name: "נועה כהן", relation: "child", email: "noa@example.com" });
    await req(alice, "POST", "/vault/stories", story);
    const dump = await h.db.db.execute(sql`SELECT * FROM vault_beneficiaries, sealed_stories`);
    const serialized = JSON.stringify(dump, (_k, v) => (v?.type === "Buffer" ? Buffer.from(v.data).toString("utf8") : v));
    expect(serialized).not.toContain("noa@example.com");
    expect(serialized).not.toContain("נועה");
    expect(serialized).not.toContain("1974");
  });

  it("detects ciphertext moved between rows (AAD binding)", async () => {
    const list = (await req(alice, "GET", "/vault/stories")).json().items;
    const second = await req(alice, "POST", "/vault/stories", { ...story, title: "סיפור שני" });
    const firstId = list[0].id as string;
    const secondId = second.json().id as string;
    // Copy the first story's encrypted body into the second row: decryption must fail, not leak.
    await h.db.db.execute(
      sql`UPDATE sealed_stories SET body_enc = (SELECT body_enc FROM sealed_stories WHERE id = ${firstId}) WHERE id = ${secondId}`,
    );
    const res = await req(alice, "GET", `/vault/stories/${secondId}`);
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("internal_error");
    await req(alice, "DELETE", `/vault/stories/${secondId}`);
  });
});

describe("sealed stories", () => {
  it("enforces audience rules and only accepts own beneficiaries", async () => {
    const [ben] = (await req(alice, "GET", "/vault/beneficiaries")).json().items;
    const specific = await req(alice, "POST", "/vault/stories", { ...story, audience: "specific", beneficiaryIds: [ben.id] });
    expect(specific.statusCode).toBe(201);
    expect(specific.json().beneficiaryIds).toEqual([ben.id]);

    const missing = await req(alice, "POST", "/vault/stories", { ...story, audience: "specific" });
    expect(missing.statusCode).toBe(400);

    // Bob creates a vault and a beneficiary; Alice must not be able to reference it.
    await req(bob, "POST", "/vault", { consentToProcessing: true });
    const bobBen = (await req(bob, "POST", "/vault/beneficiaries", { name: "Dan", relation: "sibling", email: "dan@example.com" })).json();
    const cross = await req(alice, "POST", "/vault/stories", { ...story, audience: "specific", beneficiaryIds: [bobBen.id] });
    expect(cross.statusCode).toBe(400);
    expect(cross.json().error.code).toBe("unknown_beneficiary");
  });

  it("date-released stories require a date", async () => {
    const res = await req(alice, "POST", "/vault/stories", { ...story, releaseRule: "date", releaseAt: "2045-06-01" });
    expect(res.statusCode).toBe(201);
    expect(res.json().releaseAt).toBe("2045-06-01");
  });

  it("updates replace content and audience", async () => {
    const created = (await req(alice, "POST", "/vault/stories", story)).json();
    const updated = await req(alice, "PUT", `/vault/stories/${created.id}`, { ...story, title: "כותרת חדשה", releaseRule: "on_topic", topic: "הים" });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: "כותרת חדשה", topic: "הים", releaseRule: "on_topic" });
  });
});

describe("authorization (IDOR / BOLA)", () => {
  it("never lets one user read, modify or delete another user's records", async () => {
    const aliceStory = (await req(alice, "GET", "/vault/stories")).json().items[0];
    const aliceBen = (await req(alice, "GET", "/vault/beneficiaries")).json().items[0];

    expect((await req(bob, "GET", `/vault/stories/${aliceStory.id}`)).statusCode).toBe(404);
    expect((await req(bob, "PUT", `/vault/stories/${aliceStory.id}`, story)).statusCode).toBe(404);
    expect((await req(bob, "DELETE", `/vault/stories/${aliceStory.id}`)).statusCode).toBe(404);
    expect((await req(bob, "PATCH", `/vault/beneficiaries/${aliceBen.id}`, { name: "hijack" })).statusCode).toBe(404);
    expect((await req(bob, "DELETE", `/vault/beneficiaries/${aliceBen.id}`)).statusCode).toBe(404);

    // Alice's data unchanged.
    const still = await req(alice, "GET", `/vault/stories/${aliceStory.id}`);
    expect(still.statusCode).toBe(200);
    expect((await req(alice, "GET", "/vault/beneficiaries")).json().items[0].name).toBe("נועה כהן");
  });

  it("rejects malformed ids", async () => {
    expect((await req(alice, "GET", "/vault/stories/not-a-uuid")).statusCode).toBe(400);
    expect((await req(alice, "GET", "/vault/stories/1%27%20OR%201=1")).statusCode).toBe(400);
  });
});

describe("guided answers & completeness", () => {
  it("saves (upserts) answers for catalog questions only and updates completeness", async () => {
    const unknown = await req(alice, "PUT", "/vault/answers/made.up", { text: "x" });
    expect(unknown.statusCode).toBe(400);
    expect((await req(alice, "PUT", "/vault/answers/childhood.home", { text: "בית קטן בחיפה" })).statusCode).toBe(200);
    expect((await req(alice, "PUT", "/vault/answers/childhood.home", { text: "בית קטן בחיפה, עם עץ לימון" })).statusCode).toBe(200);
    const answers = (await req(alice, "GET", "/vault/answers")).json().items;
    expect(answers).toHaveLength(1);
    expect(answers[0].text).toContain("עץ לימון");
    const summary = (await req(alice, "GET", "/vault")).json();
    expect(summary.completeness.answered).toBe(1);
    expect(summary.completeness.topics.find((t: { id: string }) => t.id === "childhood").answered).toBe(1);
  });

  it("serves the public question catalog", async () => {
    const res = await h.request({ method: "GET", url: "/questions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().topics.length).toBeGreaterThan(3);
  });
});

describe("limits", () => {
  it("caps the number of executors", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await req(alice, "POST", "/vault/executors", { name: `נאמן ${i}`, relation: "friend", email: `ex${i}@example.com` })).statusCode).toBe(201);
    }
    const sixth = await req(alice, "POST", "/vault/executors", { name: "שישי", relation: "friend", email: "ex6@example.com" });
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json().error.code).toBe("limit_reached");
  });

  it("rejects oversized payloads", async () => {
    const res = await req(alice, "POST", "/vault/stories", { ...story, body: "א".repeat(300_000) });
    expect(res.statusCode).toBe(413);
  });
});

describe("export & deletion", () => {
  it("export and delete require recent re-authentication", async () => {
    h.clock.advanceMinutes(11);
    const exp = await req(alice, "GET", "/vault/export");
    expect(exp.statusCode).toBe(403);
    expect(exp.json().error.code).toBe("reauth_required");
    expect((await req(alice, "DELETE", "/vault")).statusCode).toBe(403);
  });

  it("exports decrypted data in an open format", async () => {
    await reauth(h, alice);
    const exp = await req(alice, "GET", "/vault/export");
    expect(exp.statusCode).toBe(200);
    const data = exp.json();
    expect(data.format).toBe("inother-legacy-export");
    expect(data.stories.length).toBeGreaterThan(0);
    expect(data.stories[0].body).toContain("1974");
    expect(data.beneficiaries[0].email).toBe("noa@example.com");
  });

  it("deletes the vault and all content permanently", async () => {
    const del = await req(alice, "DELETE", "/vault");
    expect(del.statusCode).toBe(204);
    expect((await req(alice, "GET", "/vault")).statusCode).toBe(404);
    const remaining = await h.db.db.execute(sql`SELECT count(*)::int AS n FROM sealed_stories s JOIN legacy_vaults v ON v.id = s.vault_id`);
    // Only Bob's vault (with no stories) should remain.
    expect(remaining[0]?.n).toBe(0);
    const vaults = await h.db.db.select().from(legacyVaults);
    expect(vaults).toHaveLength(1);
    expect(await h.db.db.select().from(sealedStories)).toHaveLength(0);
    expect((await h.db.db.select().from(vaultBeneficiaries)).length).toBe(1); // Bob's
  });
});

describe("account", () => {
  it("records optional consents with history", async () => {
    await req(bob, "POST", "/me/consents", { purpose: "voice_cloning", granted: true });
    await req(bob, "POST", "/me/consents", { purpose: "voice_cloning", granted: false });
    const items = (await req(bob, "GET", "/me/consents")).json().items as Array<{ purpose: string; withdrawnAt: string | null }>;
    const voice = items.filter((c) => c.purpose === "voice_cloning");
    expect(voice).toHaveLength(1);
    expect(voice[0]?.withdrawnAt).not.toBeNull();
  });

  it("deletes the account and everything it owns after re-auth", async () => {
    await reauth(h, bob);
    const res = await req(bob, "DELETE", "/me");
    expect(res.statusCode).toBe(204);
    expect((await req(bob, "GET", "/me")).statusCode).toBe(401);
    expect(await h.db.db.select().from(legacyVaults)).toHaveLength(0);
    expect(await h.db.db.select().from(vaultBeneficiaries)).toHaveLength(0);
  });
});
