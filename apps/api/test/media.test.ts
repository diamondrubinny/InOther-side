import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, mediaAssets } from "../src/db/schema.js";
import { ClamdScanner } from "../src/lib/scanner.js";
import { MAX_SCAN_ATTEMPTS, RetryableScanError } from "../src/modules/media/media.processor.js";
import { ByteLimit } from "../src/modules/media/media.service.js";
import { EICAR, FakeClamd } from "./fake-clamd.js";
import { createHarness, nextIp, reauth, signUpAndLogin, type Harness } from "./harness.js";

let h: Harness;
let clamd: FakeClamd;
let alice: string;
let bob: string;

const SECRET_MARKER = "SECRET-LOCATION-MARKER-31.7683N";

/** Minimal MP3: empty ID3v2 tag followed by an MPEG-1 Layer III frame header, then payload. */
function fakeMp3(extra = ""): Buffer {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([id3, frame, Buffer.alloc(400), Buffer.from(`audio-body ${extra}`), Buffer.alloc(2000, 1)]);
}

async function jpegWithMetadata(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: SECRET_MARKER, Artist: SECRET_MARKER } })
    .toBuffer();
}

const req = (cookie: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) =>
  h.request({ method, url, cookie, body, ip: nextIp() });

async function createAndUpload(cookie: string, kind: string, contentType: string, data: Buffer, declaredType = contentType) {
  const created = await req(cookie, "POST", "/vault/media", { kind, contentType: declaredType, sizeBytes: data.length });
  if (created.statusCode !== 201) throw new Error(`create failed: ${created.body}`);
  const { id, uploadUrl } = created.json();
  const upload = await h.request({
    method: "PUT",
    url: uploadUrl,
    cookie,
    rawBody: data,
    headers: { "content-type": contentType },
    ip: nextIp(),
  });
  return { id: id as string, upload };
}

async function allStoredBytes(): Promise<Buffer> {
  const files: Buffer[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(await readFile(full));
    }
  };
  await walk(h.storageDir).catch(() => {});
  return Buffer.concat(files);
}

beforeAll(async () => {
  clamd = new FakeClamd();
  await clamd.start();
  h = await createHarness({}, { scanner: new ClamdScanner("127.0.0.1", clamd.port, 5000) });
  alice = await signUpAndLogin(h, "media-alice@example.com");
  bob = await signUpAndLogin(h, "media-bob@example.com");
  await req(alice, "POST", "/vault", { consentToProcessing: true });
  await req(bob, "POST", "/vault", { consentToProcessing: true });
});
afterAll(async () => {
  await h.close();
  await clamd.stop();
});

describe("upload reservation", () => {
  it("only allows listed types and sizes", async () => {
    const svg = await req(alice, "POST", "/vault/media", { kind: "image", contentType: "image/svg+xml", sizeBytes: 100 });
    expect(svg.statusCode).toBe(400);
    const exe = await req(alice, "POST", "/vault/media", { kind: "video", contentType: "application/x-msdownload", sizeBytes: 100 });
    expect(exe.statusCode).toBe(400);
    const huge = await req(alice, "POST", "/vault/media", { kind: "image", contentType: "image/jpeg", sizeBytes: 100 * 1024 * 1024 });
    expect(huge.statusCode).toBe(400);
  });

  it("rejects a story id from another vault", async () => {
    const bobStory = (await req(bob, "POST", "/vault/stories", { title: "t", body: "b", audience: "all", releaseRule: "on_release", delivery: "original_only" })).json();
    const res = await req(alice, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: 100, storyId: bobStory.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("unknown_story");
  });
});

describe("happy paths", () => {
  it("image: scanned, metadata stripped, encrypted at rest, downloadable", async () => {
    const original = await jpegWithMetadata();
    expect(original.toString("latin1")).toContain(SECRET_MARKER);

    const { id, upload } = await createAndUpload(alice, "image", "image/jpeg", original);
    expect(upload.statusCode).toBe(202);
    const meta = (await req(alice, "GET", `/vault/media/${id}`)).json();
    expect(meta.status).toBe("clean");

    // Nothing readable in storage: no JPEG magic bytes and no metadata marker.
    const stored = await allStoredBytes();
    expect(stored.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    expect(stored.toString("latin1")).not.toContain(SECRET_MARKER);

    const dl = await req(alice, "GET", `/vault/media/${id}/content`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("image/jpeg");
    expect(dl.headers["content-disposition"]).toBe(`attachment; filename="${id}.jpg"`);
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(dl.rawPayload.toString("latin1")).not.toContain(SECRET_MARKER);
    const info = await sharp(dl.rawPayload).metadata();
    expect(info.width).toBe(64);
    expect(info.exif).toBeUndefined();
  });

  it("audio: round-trips byte-for-byte and links to a story", async () => {
    const story = (await req(alice, "POST", "/vault/stories", { title: "שיר", body: "סבא שר", audience: "all", releaseRule: "on_release", delivery: "original_only" })).json();
    const data = fakeMp3("hello");
    const { id, upload } = await createAndUpload(alice, "audio", "audio/mpeg", data);
    expect(upload.statusCode).toBe(202);
    const patched = await req(alice, "PATCH", `/vault/media/${id}`, { storyId: story.id, label: "סבא שר בחתונה" });
    expect(patched.json()).toMatchObject({ storyId: story.id, label: "סבא שר בחתונה", status: "clean" });
    const dl = await req(alice, "GET", `/vault/media/${id}/content`);
    expect(dl.rawPayload.equals(data)).toBe(true);
    expect((await req(alice, "GET", "/vault")).json().counts.media).toBeGreaterThanOrEqual(2);
  });
});

describe("hostile files", () => {
  it("rejects a Windows executable disguised as an image", async () => {
    const pe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62), Buffer.from("PE\0\0"), Buffer.alloc(500, 7)]);
    const { id } = await createAndUpload(alice, "image", "image/png", pe);
    const meta = (await req(alice, "GET", `/vault/media/${id}`)).json();
    expect(meta).toMatchObject({ status: "rejected", statusReason: "file_type_not_allowed" });
    expect((await req(alice, "GET", `/vault/media/${id}/content`)).statusCode).toBe(409);
  });

  it("rejects HTML disguised as audio", async () => {
    const html = Buffer.from("<html><script>alert(document.cookie)</script></html>".padEnd(600, " "));
    const { id } = await createAndUpload(alice, "audio", "audio/mpeg", html);
    expect((await req(alice, "GET", `/vault/media/${id}`)).json().status).toBe("rejected");
  });

  it("rejects a corrupt image that only has a valid header", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 0x41)]);
    const { id } = await createAndUpload(alice, "image", "image/jpeg", broken);
    const meta = (await req(alice, "GET", `/vault/media/${id}`)).json();
    expect(meta.status).toBe("rejected");
  });

  it("quarantines and destroys malware (EICAR), never serving it", async () => {
    const scansBefore = clamd.scans;
    const { id } = await createAndUpload(alice, "audio", "audio/mpeg", fakeMp3(EICAR));
    expect(clamd.scans).toBe(scansBefore + 1);
    const meta = (await req(alice, "GET", `/vault/media/${id}`)).json();
    expect(meta).toMatchObject({ status: "infected", statusReason: "malware_detected" });
    expect((await req(alice, "GET", `/vault/media/${id}/content`)).statusCode).toBe(409);
    expect((await allStoredBytes()).toString("latin1")).not.toContain("EICAR");
    const audit = await h.db.db.select().from(auditLog).where(eq(auditLog.targetId, id));
    expect(audit.some((a) => a.action === "media.infected")).toBe(true);
  });

  it("fails closed when the scanner is down, then gives up after max attempts", async () => {
    clamd.failing = true;
    try {
      const { id } = await createAndUpload(alice, "audio", "audio/mpeg", fakeMp3("x"));
      // First attempt happened inline and failed: file stays quarantined, not served.
      expect((await req(alice, "GET", `/vault/media/${id}`)).json().status).toBe("quarantined");
      expect((await req(alice, "GET", `/vault/media/${id}/content`)).statusCode).toBe(409);
      for (let i = 2; i < MAX_SCAN_ATTEMPTS; i++) {
        await expect(h.processor.process(id)).rejects.toBeInstanceOf(RetryableScanError);
      }
      expect(await h.processor.process(id)).toBe("skipped");
      expect((await req(alice, "GET", `/vault/media/${id}`)).json()).toMatchObject({ status: "scan_failed", statusReason: "scanner_unavailable" });
    } finally {
      clamd.failing = false;
    }
  });
});

describe("upload protocol", () => {
  it("enforces declared content type and exact length; slot is single-use", async () => {
    const data = fakeMp3("len");
    const created = (await req(alice, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: data.length })).json();
    const put = (body: Buffer, type = "audio/mpeg") =>
      h.request({ method: "PUT", url: `/vault/media/${created.id}/content`, cookie: alice, rawBody: body, headers: { "content-type": type }, ip: nextIp() });

    expect((await put(data, "audio/ogg")).statusCode).toBe(415);
    expect((await put(Buffer.concat([data, Buffer.alloc(10)]))).json().error.code).toBe("content_length_mismatch");
    expect((await put(data.subarray(0, 100))).json().error.code).toBe("content_length_mismatch");
    expect((await put(data)).statusCode).toBe(202);
    expect((await put(data)).json().error.code).toBe("upload_not_allowed");
  });

  it("ByteLimit aborts streams that exceed the limit", async () => {
    const limiter = new ByteLimit(5);
    const errors: Error[] = [];
    limiter.on("error", (e) => errors.push(e));
    limiter.write(Buffer.alloc(3));
    limiter.write(Buffer.alloc(3));
    await new Promise((r) => setImmediate(r));
    expect(errors[0]?.message).toBe("payload_too_large");
  });
});

describe("authorization (IDOR)", () => {
  it("another user cannot see, download, upload to, modify or delete my files", async () => {
    const data = fakeMp3("private");
    const { id } = await createAndUpload(alice, "audio", "audio/mpeg", data);
    const pending = (await req(alice, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: data.length })).json();

    expect((await req(bob, "GET", `/vault/media/${id}`)).statusCode).toBe(404);
    expect((await req(bob, "GET", `/vault/media/${id}/content`)).statusCode).toBe(404);
    expect((await req(bob, "PATCH", `/vault/media/${id}`, { label: "x" })).statusCode).toBe(404);
    expect((await req(bob, "DELETE", `/vault/media/${id}`)).statusCode).toBe(404);
    const hijack = await h.request({ method: "PUT", url: `/vault/media/${pending.id}/content`, cookie: bob, rawBody: data, headers: { "content-type": "audio/mpeg" }, ip: nextIp() });
    expect(hijack.statusCode).toBe(404);
    expect((await req(bob, "GET", "/vault/media")).json().items.every((m: { id: string }) => m.id !== id)).toBe(true);
    expect((await req(alice, "GET", `/vault/media/${id}/content`)).rawPayload.equals(data)).toBe(true);
  });

  it("requires a verified session", async () => {
    expect((await h.request({ method: "GET", url: "/vault/media" })).statusCode).toBe(401);
  });
});

describe("limits, deletion and cleanup", () => {
  it("caps pending reservations", async () => {
    const carol = await signUpAndLogin(h, "media-carol@example.com");
    await req(carol, "POST", "/vault", { consentToProcessing: true });
    for (let i = 0; i < 10; i++) {
      expect((await req(carol, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: 100 })).statusCode).toBe(201);
    }
    const eleventh = await req(carol, "POST", "/vault/media", { kind: "audio", contentType: "audio/mpeg", sizeBytes: 100 });
    expect(eleventh.json().error.code).toBe("too_many_pending_uploads");

    // Stale reservations are cleaned up after 24h.
    h.clock.advanceMinutes(25 * 60);
    const media = await import("../src/modules/media/media.service.js");
    const { VaultService } = await import("../src/modules/vault/vault.service.js");
    const svc = new media.MediaService(h.ctx, new VaultService(h.ctx));
    expect(await svc.cleanupStalePending()).toBeGreaterThanOrEqual(10);
    // (The session itself idled out after 24h, so check the database directly.)
    const left = await h.db.db.select().from(mediaAssets).where(eq(mediaAssets.status, "awaiting_upload"));
    expect(left).toHaveLength(0);
  });

  it("enforces the storage quota", async () => {
    const q = await createHarness({ MEDIA_QUOTA_BYTES: "5000" });
    try {
      const dave = await signUpAndLogin(q, "media-dave@example.com");
      await q.request({ method: "POST", url: "/vault", cookie: dave, body: { consentToProcessing: true }, ip: nextIp() });
      const ok = await q.request({ method: "POST", url: "/vault/media", cookie: dave, body: { kind: "audio", contentType: "audio/mpeg", sizeBytes: 4000 }, ip: nextIp() });
      expect(ok.statusCode).toBe(201);
      const over = await q.request({ method: "POST", url: "/vault/media", cookie: dave, body: { kind: "audio", contentType: "audio/mpeg", sizeBytes: 2000 }, ip: nextIp() });
      expect(over.json().error.code).toBe("quota_exceeded");
    } finally {
      await q.close();
      // The quota harness truncated shared tables; recreate our users for the remaining tests.
      alice = await signUpAndLogin(h, "media-alice2@example.com");
      await req(alice, "POST", "/vault", { consentToProcessing: true });
    }
  });

  it("deleting a file removes it from storage; deleting the vault removes everything", async () => {
    const { id } = await createAndUpload(alice, "audio", "audio/mpeg", fakeMp3("to-delete"));
    expect((await allStoredBytes()).length).toBeGreaterThan(0);
    expect((await req(alice, "DELETE", `/vault/media/${id}`)).statusCode).toBe(204);
    expect(await h.db.db.select().from(mediaAssets).where(eq(mediaAssets.id, id))).toHaveLength(0);

    const kept = await createAndUpload(alice, "audio", "audio/mpeg", fakeMp3("keep"));
    const vaultId = (await req(alice, "GET", "/vault")).json().id as string;
    const vaultMediaDir = path.join(h.storageDir, "media", vaultId);
    expect(await readdir(vaultMediaDir)).toContain(kept.id);
    await reauth(h, alice);
    expect((await req(alice, "DELETE", "/vault")).statusCode).toBe(204);
    await expect(readdir(vaultMediaDir)).rejects.toThrow();
    await expect(readdir(path.join(h.storageDir, "quarantine", vaultId))).rejects.toThrow();
  });
});
