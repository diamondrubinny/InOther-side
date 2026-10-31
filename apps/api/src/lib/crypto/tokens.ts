import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";

/** 32 random bytes, base64url: used for session tokens and email links. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export class Hmac {
  private readonly key: Buffer;
  constructor(secretBase64: string) {
    this.key = Buffer.from(secretBase64, "base64");
  }

  /** Keyed hash for pseudonymous identifiers (e.g. IPs in logs). */
  hex(value: string, purpose: string): string {
    return createHmac("sha256", this.key).update(`${purpose}\u0000${value}`).digest("hex").slice(0, 32);
  }
}

/** Recovery code: 10 base32 chars shown as XXXXX-XXXXX. */
export function generateRecoveryCode(): string {
  const raw = encodeBase32UpperCaseNoPadding(randomBytes(7)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/-/g, "");
}
