import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * Streaming authenticated encryption for large files (audio / video), using the
 * "STREAM" construction (Hoang, Reyhanitabar, Rogaway, Vizár 2015), as in Google Tink:
 *
 *   header  = version(1) || salt(16) || chunkSize(4, BE)
 *   key     = HKDF-SHA256(dek, salt, "inother-stream-v1|" + aad)   -- fresh key per object
 *   chunk_i = AES-256-GCM(key, nonce = 0^7 || i(4, BE) || last(1), plaintext_i) || tag(16)
 *
 * Properties: each chunk is authenticated before any of its plaintext is released;
 * reordering, truncation, or appending chunks is detected; the object is bound to its AAD
 * (e.g. "media.content:<assetId>") so ciphertext cannot be swapped between objects.
 */
const VERSION = 1;
const SALT_LEN = 16;
const HEADER_LEN = 1 + SALT_LEN + 4;
const TAG_LEN = 16;
export const DEFAULT_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_CHUNKS = 0xffffffff;

function deriveKey(dek: Buffer, salt: Buffer, aad: string): Buffer {
  return Buffer.from(hkdfSync("sha256", dek, salt, `inother-stream-v1|${aad}`, 32));
}

function nonce(counter: number, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  n.writeUInt32BE(counter, 7);
  n[11] = last ? 1 : 0;
  return n;
}

export function createEncryptStream(dek: Buffer, aad: string, chunkSize = DEFAULT_CHUNK_SIZE): Transform {
  if (dek.length !== 32) throw new Error("dek must be 32 bytes");
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(dek, salt, aad);
  let counter = 0;
  let pending: Buffer[] = [];
  let pendingLen = 0;
  let headerSent = false;

  const seal = (plaintext: Buffer, last: boolean): Buffer => {
    if (counter >= MAX_CHUNKS) throw new Error("stream too long");
    const cipher = createCipheriv("aes-256-gcm", key, nonce(counter++, last));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([ct, cipher.getAuthTag()]);
  };

  const header = (): Buffer => {
    const h = Buffer.alloc(HEADER_LEN);
    h[0] = VERSION;
    salt.copy(h, 1);
    h.writeUInt32BE(chunkSize, 1 + SALT_LEN);
    return h;
  };

  return new Transform({
    transform(data: Buffer, _enc, cb: TransformCallback) {
      try {
        if (!headerSent) {
          this.push(header());
          headerSent = true;
        }
        pending.push(data);
        pendingLen += data.length;
        // Keep at least one byte back so the final chunk is always emitted in flush() with last=1.
        if (pendingLen > chunkSize) {
          let buf = Buffer.concat(pending);
          while (buf.length > chunkSize) {
            this.push(seal(buf.subarray(0, chunkSize), false));
            buf = buf.subarray(chunkSize);
          }
          pending = [buf];
          pendingLen = buf.length;
        }
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb: TransformCallback) {
      try {
        if (!headerSent) this.push(header());
        this.push(seal(Buffer.concat(pending), true));
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

export function createDecryptStream(dek: Buffer, aad: string): Transform {
  if (dek.length !== 32) throw new Error("dek must be 32 bytes");
  let key: Buffer | null = null;
  let chunkSize = 0;
  let counter = 0;
  let buf: Buffer = Buffer.alloc(0);

  const open = (sealed: Buffer, last: boolean): Buffer => {
    if (sealed.length < TAG_LEN) throw new Error("truncated ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key as Buffer, nonce(counter++, last));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LEN));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_LEN)), decipher.final()]);
  };

  return new Transform({
    transform(data: Buffer, _enc, cb: TransformCallback) {
      try {
        buf = buf.length === 0 ? data : Buffer.concat([buf, data]);
        if (!key) {
          if (buf.length < HEADER_LEN) return cb();
          if (buf[0] !== VERSION) throw new Error("unsupported stream version");
          const salt = buf.subarray(1, 1 + SALT_LEN);
          chunkSize = buf.readUInt32BE(1 + SALT_LEN);
          if (chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) throw new Error("invalid chunk size");
          key = deriveKey(dek, Buffer.from(salt), aad);
          buf = buf.subarray(HEADER_LEN);
        }
        const sealedSize = chunkSize + TAG_LEN;
        // A full-size chunk is only "not last" if more data follows it.
        while (buf.length > sealedSize) {
          this.push(open(buf.subarray(0, sealedSize), false));
          buf = buf.subarray(sealedSize);
        }
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb: TransformCallback) {
      try {
        if (!key) throw new Error("truncated ciphertext");
        this.push(open(buf, true));
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}
