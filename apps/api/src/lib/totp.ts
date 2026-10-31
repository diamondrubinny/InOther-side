import { randomBytes } from "node:crypto";
import { createTOTPKeyURI, generateHOTP, verifyHOTP } from "@oslojs/otp";
import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept one step of clock drift in each direction. */
const DRIFT_STEPS = 1;

export function generateTotpSecret(): Buffer {
  return randomBytes(20); // 160 bits, as recommended by RFC 4226
}

export function totpUri(issuer: string, accountName: string, secret: Uint8Array): string {
  return createTOTPKeyURI(issuer, accountName, secret, TOTP_PERIOD_SECONDS, TOTP_DIGITS);
}

export function base32Secret(secret: Uint8Array): string {
  return encodeBase32UpperCaseNoPadding(secret);
}

export function currentCounter(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * Returns the matched time-step counter, or null. The caller must reject counters <= the last
 * accepted counter for this user to prevent replay of an already-used code.
 */
export function matchTotp(secret: Uint8Array, code: string, nowMs = Date.now()): number | null {
  const now = currentCounter(nowMs);
  for (let offset = -DRIFT_STEPS; offset <= DRIFT_STEPS; offset++) {
    const counter = now + offset;
    if (verifyHOTP(secret, BigInt(counter), TOTP_DIGITS, code)) return counter;
  }
  return null;
}

/** Test helper: generate the code for a given time. */
export function totpAt(secret: Uint8Array, nowMs = Date.now()): string {
  return generateHOTP(secret, BigInt(currentCounter(nowMs)), TOTP_DIGITS);
}
