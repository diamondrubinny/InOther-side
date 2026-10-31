import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@inother/shared";
import { errorMessage, format, getMessages } from "./index";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [ik, iv] of flatten(v, key)) out.set(ik, iv);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("UI translations", () => {
  const he = flatten(getMessages("he") as unknown as Tree);

  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: same keys and placeholders as Hebrew, no empty strings`, () => {
      const msgs = flatten(getMessages(locale) as unknown as Tree);
      expect([...msgs.keys()].sort()).toEqual([...he.keys()].sort());
      for (const [key, text] of msgs) {
        expect(text.trim().length, `${locale}:${key} is empty`).toBeGreaterThan(0);
        expect(placeholders(text), `${locale}:${key} placeholders`).toEqual(placeholders(he.get(key) ?? ""));
      }
    });
  }

  it("non-English locales are actually translated (not copied from English)", () => {
    const en = flatten(getMessages("en") as unknown as Tree);
    for (const locale of ["he", "ar", "ru"] as const) {
      const msgs = flatten(getMessages(locale) as unknown as Tree);
      const words = (v: string) => /[a-z]{4,}/i.test(v.replace(/\{\w+\}/g, ""));
      const copied = [...msgs].filter(([k, v]) => v === en.get(k) && words(v) && !k.startsWith("meta.siteName"));
      expect(copied.map(([k]) => k), locale).toEqual([]);
    }
  });

  it("formats placeholders and maps API error codes", () => {
    expect(format("שלום {name}", { name: "דנה" })).toBe("שלום דנה");
    expect(format("{a}/{b}", { a: 1 })).toBe("1/{b}");
    const he = getMessages("he");
    expect(errorMessage(he, "invalid_credentials")).toBe(he.errors.invalid_credentials);
    expect(errorMessage(he, "something_unknown")).toBe(he.errors.generic);
    expect(errorMessage(he, undefined)).toBe(he.errors.generic);
  });
});
