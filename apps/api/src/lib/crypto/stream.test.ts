import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { createDecryptStream, createEncryptStream } from "./stream.js";

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function encrypt(dek: Buffer, data: Buffer, aad: string, chunk = 1024, pieces = 7): Promise<Buffer> {
  // Feed input in irregular slices to exercise buffering.
  const parts: Buffer[] = [];
  for (let i = 0; i < data.length; i += pieces * 37) parts.push(data.subarray(i, i + pieces * 37));
  return collect(Readable.from(parts).pipe(createEncryptStream(dek, aad, chunk)));
}

async function decrypt(dek: Buffer, data: Buffer, aad: string): Promise<Buffer> {
  const out: Buffer[] = [];
  const parts: Buffer[] = [];
  for (let i = 0; i < data.length; i += 500) parts.push(data.subarray(i, i + 500));
  await pipeline(Readable.from(parts), createDecryptStream(dek, aad), async function* (src) {
    for await (const c of src) out.push(c as Buffer);
  });
  return Buffer.concat(out);
}

describe("streaming AEAD", () => {
  const dek = randomBytes(32);

  it.each([0, 1, 1023, 1024, 1025, 4096, 50_000])("round-trips %i bytes", async (size) => {
    const data = randomBytes(size);
    const enc = await encrypt(dek, data, "media.content:a");
    expect(enc.includes(data.subarray(0, Math.min(16, size))) && size >= 16).toBe(false);
    expect((await decrypt(dek, enc, "media.content:a")).equals(data)).toBe(true);
  });

  it("produces different ciphertext each time (fresh salt)", async () => {
    const data = randomBytes(3000);
    expect((await encrypt(dek, data, "x")).equals(await encrypt(dek, data, "x"))).toBe(false);
  });

  it("rejects wrong key, wrong AAD, tampering, truncation, reordering and appending", async () => {
    const data = randomBytes(5000);
    const enc = await encrypt(dek, data, "media.content:a");
    const sealed = 1024 + 16;
    const header = 21;

    await expect(decrypt(randomBytes(32), enc, "media.content:a")).rejects.toThrow();
    await expect(decrypt(dek, enc, "media.content:b")).rejects.toThrow();

    const flipped = Buffer.from(enc);
    flipped[header + 10] = (flipped[header + 10] ?? 0) ^ 1;
    await expect(decrypt(dek, flipped, "media.content:a")).rejects.toThrow();

    // Drop the last chunk: the new final chunk was sealed as "not last".
    const truncated = enc.subarray(0, header + sealed * 2);
    await expect(decrypt(dek, truncated, "media.content:a")).rejects.toThrow();

    const c0 = enc.subarray(header, header + sealed);
    const c1 = enc.subarray(header + sealed, header + sealed * 2);
    const reordered = Buffer.concat([enc.subarray(0, header), c1, c0, enc.subarray(header + sealed * 2)]);
    await expect(decrypt(dek, reordered, "media.content:a")).rejects.toThrow();

    const appended = Buffer.concat([enc, c0]);
    await expect(decrypt(dek, appended, "media.content:a")).rejects.toThrow();

    await expect(decrypt(dek, enc.subarray(0, 10), "media.content:a")).rejects.toThrow();
  });
});
