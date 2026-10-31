import { z } from "zod";

/**
 * Supported interface / content languages.
 * he = Hebrew (default), en = English, ar = Arabic, ru = Russian, fr = French, es = Spanish.
 * NOTE: All non-Hebrew/English texts are drafts and must be reviewed by native speakers
 * (ideally with grief-care sensitivity) before launch.
 */
export const SUPPORTED_LOCALES = ["he", "en", "ar", "ru", "fr", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "he";

export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["he", "ar"]);

export const LOCALE_INFO: Record<Locale, { nativeName: string; dir: "rtl" | "ltr" }> = {
  he: { nativeName: "עברית", dir: "rtl" },
  en: { nativeName: "English", dir: "ltr" },
  ar: { nativeName: "العربية", dir: "rtl" },
  ru: { nativeName: "Русский", dir: "ltr" },
  fr: { nativeName: "Français", dir: "ltr" },
  es: { nativeName: "Español", dir: "ltr" },
};

export const localeSchema = z.enum(SUPPORTED_LOCALES);

/** A text available in every supported locale (enforced by the type system). */
export type LocalizedText = Record<Locale, string>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function textDirection(locale: Locale): "rtl" | "ltr" {
  return LOCALE_INFO[locale].dir;
}

/**
 * Picks the best supported locale from an HTTP Accept-Language header,
 * honoring q-values; falls back to the default locale.
 */
export function negotiateLocale(acceptLanguage: string | undefined | null, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (!acceptLanguage) return fallback;
  const candidates = acceptLanguage
    .split(",")
    .slice(0, 20)
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { base: tag.toLowerCase().split("-")[0] ?? "", q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((c) => c.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  // "iw" is the legacy code for Hebrew.
  for (const c of candidates) {
    const base = c.base === "iw" ? "he" : c.base;
    if (isLocale(base)) return base;
  }
  return fallback;
}
