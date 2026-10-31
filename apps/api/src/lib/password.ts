import argon2 from "argon2";

/**
 * argon2id parameters, in line with the OWASP Password Storage Cheat Sheet
 * (m=19 MiB, t=2, p=1 is the OWASP minimum; we use a higher memory cost).
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // KiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, HASH_OPTIONS);
}

let dummyHashPromise: Promise<string> | undefined;
/**
 * Verifies against a dummy hash so that "unknown email" takes the same time as "wrong password"
 * (prevents account enumeration through response timing).
 */
export async function burnPasswordVerification(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword("dummy-password-for-timing-equalization");
  await verifyPassword(await dummyHashPromise, password);
}

/** Small blocklist of extremely common passwords (NIST SP 800-63B recommends blocklisting). */
const COMMON_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "passwordpassword",
  "qwertyuiopas",
  "111111111111",
  "123123123123",
  "iloveyou1234",
  "aaaaaaaaaaaa",
  "abcdefghijkl",
  "1q2w3e4r5t6y",
  "qwerty123456",
  "password123!",
]);

export function isWeakPassword(password: string, context: { email: string; displayName: string }): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  if (new Set(lower).size <= 3) return true;
  const localPart = context.email.split("@")[0] ?? "";
  if (localPart.length >= 4 && lower.includes(localPart.toLowerCase())) return true;
  const name = context.displayName.trim().toLowerCase();
  if (name.length >= 4 && lower.includes(name)) return true;
  return false;
}
