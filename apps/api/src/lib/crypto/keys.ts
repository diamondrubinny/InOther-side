import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const FORMAT_VERSION = 1;

/**
 * Ciphertext layout: [version:1][iv:12][tag:16][ciphertext:n]
 * The caller supplies "associated data" (AAD) that binds the ciphertext to its context
 * (e.g. "story.title:<storyId>"), so encrypted values cannot be swapped between rows/columns.
 */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  if (key.length !== 32) throw new Error("key must be 32 bytes");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, tag, ct]);
}

export function aesGcmDecrypt(key: Buffer, payload: Buffer, aad: string): Buffer {
  if (key.length !== 32) throw new Error("key must be 32 bytes");
  if (payload.length < 1 + IV_LEN + TAG_LEN || payload[0] !== FORMAT_VERSION) {
    throw new Error("invalid ciphertext");
  }
  const iv = payload.subarray(1, 1 + IV_LEN);
  const tag = payload.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = payload.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Wraps and unwraps data-encryption keys (DEKs).
 * The local implementation keeps the KEK in memory (from env). A cloud KMS implementation
 * (AWS KMS / GCP KMS) can be added behind the same interface without changing callers.
 */
export interface KeyProvider {
  readonly kekId: string;
  wrapKey(dek: Buffer, context: string): Promise<Buffer>;
  unwrapKey(wrapped: Buffer, kekId: string, context: string): Promise<Buffer>;
  /** Encrypt small secrets directly with the KEK (e.g. TOTP secrets). */
  encryptSecret(plaintext: Buffer, context: string): Promise<Buffer>;
  decryptSecret(payload: Buffer, context: string): Promise<Buffer>;
}

export class LocalKeyProvider implements KeyProvider {
  private readonly kek: Buffer;

  constructor(
    kekBase64: string,
    public readonly kekId: string,
  ) {
    const raw = Buffer.from(kekBase64, "base64");
    if (raw.length < 32) throw new Error("master key must be at least 32 bytes");
    this.kek = raw.subarray(0, 32);
  }

  async wrapKey(dek: Buffer, context: string): Promise<Buffer> {
    return aesGcmEncrypt(this.kek, dek, `dek:${context}`);
  }

  async unwrapKey(wrapped: Buffer, kekId: string, context: string): Promise<Buffer> {
    if (kekId !== this.kekId) throw new Error("unknown key-encryption key id");
    return aesGcmDecrypt(this.kek, wrapped, `dek:${context}`);
  }

  async encryptSecret(plaintext: Buffer, context: string): Promise<Buffer> {
    return aesGcmEncrypt(this.kek, plaintext, `secret:${context}`);
  }

  async decryptSecret(payload: Buffer, context: string): Promise<Buffer> {
    return aesGcmDecrypt(this.kek, payload, `secret:${context}`);
  }
}

export function generateDek(): Buffer {
  return randomBytes(32);
}

/** Field-level encryption bound to a single vault's DEK. */
export class VaultCipher {
  constructor(private readonly dek: Buffer) {}

  encrypt(value: string, aad: string): Buffer {
    return aesGcmEncrypt(this.dek, Buffer.from(value, "utf8"), aad);
  }

  decrypt(payload: Buffer, aad: string): string {
    return aesGcmDecrypt(this.dek, payload, aad).toString("utf8");
  }
}
