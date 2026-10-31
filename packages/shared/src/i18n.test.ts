import { describe, expect, it } from "vitest";
import {
  QUESTION_TOPICS,
  SUPPORTED_LOCALES,
  createMediaSchema,
  localizedCatalog,
  negotiateLocale,
  textDirection,
} from "./index.js";

describe("negotiateLocale", () => {
  it("honors q-values and order, ignores unsupported languages", () => {
    expect(negotiateLocale("de-DE,ru;q=0.8,en;q=0.9")).toBe("en");
    expect(negotiateLocale("ar-IL,he;q=0.9")).toBe("ar");
    expect(negotiateLocale("fr-CA")).toBe("fr");
    expect(negotiateLocale("iw")).toBe("he");
    expect(negotiateLocale("de, ja;q=0.5")).toBe("he");
    expect(negotiateLocale(undefined, "en")).toBe("en");
    expect(negotiateLocale("en;q=0, es")).toBe("es");
    expect(negotiateLocale("garbage;;;q=abc")).toBe("he");
  });

  it("knows text direction", () => {
    expect(textDirection("he")).toBe("rtl");
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("ru")).toBe("ltr");
  });
});

describe("translations", () => {
  it("every topic and question has non-empty text in every locale", () => {
    for (const topic of QUESTION_TOPICS) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(topic.title[locale]?.trim().length, `${topic.id}/${locale}`).toBeGreaterThan(0);
        for (const q of topic.questions) {
          expect(q.text[locale]?.trim().length, `${q.id}/${locale}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("does not leave English placeholders in other locales", () => {
    for (const topic of QUESTION_TOPICS) {
      for (const q of topic.questions) {
        for (const locale of SUPPORTED_LOCALES.filter((l) => l !== "en")) {
          expect(q.text[locale], `${q.id}/${locale}`).not.toBe(q.text.en);
        }
      }
    }
  });

  it("flattens the catalog for one locale", () => {
    const ru = localizedCatalog("ru");
    expect(ru[0]?.title).toBe("Детство");
    expect(ru[0]?.questions[0]?.text).toContain("дом");
  });
});

describe("createMediaSchema", () => {
  it("accepts allowed types within limits and rejects others", () => {
    expect(createMediaSchema.safeParse({ kind: "audio", contentType: "audio/mpeg", sizeBytes: 1000 }).success).toBe(true);
    expect(createMediaSchema.safeParse({ kind: "image", contentType: "image/svg+xml", sizeBytes: 1000 }).success).toBe(false);
    expect(createMediaSchema.safeParse({ kind: "image", contentType: "image/jpeg", sizeBytes: 26 * 1024 * 1024 }).success).toBe(false);
    expect(createMediaSchema.safeParse({ kind: "video", contentType: "application/x-msdownload", sizeBytes: 10 }).success).toBe(false);
  });
});
