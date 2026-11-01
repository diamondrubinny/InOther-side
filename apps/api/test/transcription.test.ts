import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mediaTranscripts } from "../src/db/schema.js";
import { TranscriptionService } from "../src/modules/media/transcription.service.js";
import { VaultService } from "../src/modules/vault/vault.service.js";
import { createHarness, nextIp, signUpAndLogin, type Harness } from "./harness.js";

let h: Harness;
let legator: string;
let stranger: string;
let vaultId: string;
type M = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const req = (cookie: string, method: M, url: string, body?: unknown) => h.request({ method, url, cookie, body, ip: nextIp() });

function mp3(transcript: string): Buffer {
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(400), Buffer.from(`TRANSCRIPT:${transcript}:END`), Buffer.alloc(1500, 1)]);
}
async function upload(data: Buffer, label: string): Promise<string> {
  const c = (await req(legator, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: data.length, label })).json();
  await h.request({ method: "PUT", url: c.uploadUrl, cookie: legator, rawBody: data, headers: { "content-type": "audio/mpeg" }, ip: nextIp() });
  return c.id;
}

beforeAll(async () => {
  h = await createHarness();
  // Run transcription inline, like the worker would.
  const svc = new TranscriptionService(h.ctx, new VaultService(h.ctx));
  h.queue.onTranscribe = async (id) => {
    await svc.process(id).catch(() => {});
  };
  legator = await signUpAndLogin(h, "tr-legator@example.com");
  stranger = await signUpAndLogin(h, "tr-stranger@example.com");
  vaultId = (await req(legator, "POST", "/vault", { consentToProcessing: true })).json().id;
  await req(stranger, "POST", "/vault", { consentToProcessing: true });
});
afterAll(async () => {
  await h.close();
});

describe("transcription of the legator's recordings", () => {
  it("does nothing without AI-processing consent", async () => {
    const id = await upload(mp3("סיפור בלי הסכמה"), "בלי הסכמה");
    expect((await req(legator, "GET", `/vault/media/${id}/transcript`)).json().status).toBe("none");
  });

  it("transcribes clean recordings after consent, stores encrypted, and shows status", async () => {
    await req(legator, "POST", "/me/consents", { purpose: "ai_processing", granted: true });
    const id = await upload(mp3("כשהייתי בן עשר עלינו לארץ באונייה קטנה"), "העלייה לארץ");
    const t = (await req(legator, "GET", `/vault/media/${id}/transcript`)).json();
    expect(t).toMatchObject({ status: "done", text: "כשהייתי בן עשר עלינו לארץ באונייה קטנה", editedByLegator: false });
    const [row] = await h.db.db.select().from(mediaTranscripts).where(eq(mediaTranscripts.mediaId, id));
    expect(row?.textEnc?.toString("utf8")).not.toContain("אונייה");
    const list = (await req(legator, "GET", "/vault/media")).json().items;
    expect(list.find((m: { id: string }) => m.id === id).transcriptStatus).toBe("done");
  });

  it("the persona uses transcripts and can play the original recording", async () => {
    const sid = (await req(legator, "POST", `/persona/vaults/${vaultId}/sessions`, {})).json().sessionId;
    const res = await req(legator, "POST", `/persona/sessions/${sid}/messages`, { text: "איך עליתם לארץ באונייה?" });
    const events = res.body.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const play = events.find((e: { type: string }) => e.type === "play_media");
    expect(play).toMatchObject({ title: "העלייה לארץ" });
    expect(res.body).not.toContain("PLAY_MEDIA");
  });

  it("legator corrections are kept and never overwritten by re-transcription", async () => {
    const list = (await req(legator, "GET", "/vault/media")).json().items;
    const id = list.find((m: { label: string }) => m.label === "העלייה לארץ").id;
    const edited = (await req(legator, "PUT", `/vault/media/${id}/transcript`, { text: "כשהייתי בן עשר עלינו לארץ באוניית מעפילים" })).json();
    expect(edited).toMatchObject({ editedByLegator: true, text: "כשהייתי בן עשר עלינו לארץ באוניית מעפילים" });
    await new TranscriptionService(h.ctx, new VaultService(h.ctx)).process(id);
    expect((await req(legator, "GET", `/vault/media/${id}/transcript`)).json().text).toContain("מעפילים");
  });

  it("is private to the legator", async () => {
    const id = (await req(legator, "GET", "/vault/media")).json().items[0].id;
    expect((await req(stranger, "GET", `/vault/media/${id}/transcript`)).statusCode).toBe(404);
    expect((await req(stranger, "PUT", `/vault/media/${id}/transcript`, { text: "x" })).statusCode).toBe(404);
    expect((await req(stranger, "DELETE", `/vault/media/${id}/transcript`)).statusCode).toBe(404);
  });
});

describe("marker hygiene", () => {
  it("never shows or speaks malformed playback markers from the model", async () => {
    const { MockLlm } = await import("../src/modules/persona/providers/llm.js");
    class BadLlm extends MockLlm {
      override async *streamReply() {
        yield "שלום [[PLAY_MEDIA:not-a-real";
        yield "-id]] וגם [[PLAY_STORY:…]] סוף.";
      }
    }
    const h2 = await createHarness({}, {});
    try {
      (h2.ctx as { llm: unknown }).llm = new BadLlm();
      const { PersonaService } = await import("../src/modules/persona/persona.service.js");
      const svc = new PersonaService(h2.ctx, new VaultService(h2.ctx), h2.ctx.llm, h2.ctx.voice);
      const owner = await signUpAndLogin(h2, "marker@example.com");
      const vid = (await h2.request({ method: "POST", url: "/vault", cookie: owner, body: { consentToProcessing: true }, ip: nextIp() })).json().id;
      await h2.request({ method: "POST", url: "/me/consents", cookie: owner, body: { purpose: "ai_processing", granted: true }, ip: nextIp() });
      const me = (await h2.request({ method: "GET", url: "/me", cookie: owner })).json();
      const { sessionId } = await svc.start(me.id, vid, "regular", "he", null);
      const out: { type: string; delta?: string; text?: string | null }[] = [];
      for await (const e of svc.message(sessionId, me.id, "היי")) out.push(e);
      const shown = out.filter((e) => e.type === "text").map((e) => e.delta).join("") + out.filter((e) => e.type === "segment").map((e) => e.text).join("");
      expect(shown).not.toContain("[[");
      expect(shown).toContain("סוף");
    } finally {
      await h2.close();
    }
  });
});
