import { describe, expect, it } from "vitest";
import {
  CURRENT_TERMS_VERSION,
  QUESTION_TOPICS,
  TOTAL_QUESTIONS,
  findQuestion,
  loginMfaSchema,
  registerSchema,
  storyInputSchema,
} from "./index.js";

describe("registerSchema", () => {
  const valid = {
    email: "  Dana@Example.COM ",
    password: "correct horse battery",
    displayName: "דנה",
    confirmAdult: true,
    acceptTerms: true,
    termsVersion: CURRENT_TERMS_VERSION,
  };

  it("normalizes email", () => {
    expect(registerSchema.parse(valid).email).toBe("dana@example.com");
  });

  it("rejects short passwords and missing adult confirmation", () => {
    expect(registerSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, confirmAdult: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, termsVersion: "old" }).success).toBe(false);
  });
});

describe("loginMfaSchema", () => {
  it("requires exactly one of code / recoveryCode", () => {
    const token = "x".repeat(40);
    expect(loginMfaSchema.safeParse({ challengeToken: token }).success).toBe(false);
    expect(loginMfaSchema.safeParse({ challengeToken: token, code: "123456" }).success).toBe(true);
    expect(
      loginMfaSchema.safeParse({ challengeToken: token, code: "123456", recoveryCode: "ABCDE-FGHIJ" }).success,
    ).toBe(false);
  });
});

describe("storyInputSchema", () => {
  const base = {
    title: "הסיפור על סבא",
    body: "פעם אחת...",
    audience: "all" as const,
    releaseRule: "on_release" as const,
    delivery: "original_only" as const,
  };

  it("accepts a minimal story and applies defaults", () => {
    const parsed = storyInputSchema.parse(base);
    expect(parsed.beneficiaryIds).toEqual([]);
    expect(parsed.releaseAt).toBeNull();
  });

  it("enforces cross-field rules", () => {
    expect(storyInputSchema.safeParse({ ...base, audience: "specific" }).success).toBe(false);
    expect(storyInputSchema.safeParse({ ...base, releaseRule: "date" }).success).toBe(false);
    expect(storyInputSchema.safeParse({ ...base, releaseRule: "date", releaseAt: "2040-05-01" }).success).toBe(true);
    expect(storyInputSchema.safeParse({ ...base, releaseRule: "on_topic" }).success).toBe(false);
  });
});

describe("question catalog", () => {
  it("has unique, well-formed ids", () => {
    const ids = QUESTION_TOPICS.flatMap((t) => t.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(TOTAL_QUESTIONS);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_.-]{1,64}$/);
    expect(findQuestion("legacy.untold")?.sensitive).toBe(true);
  });
});
