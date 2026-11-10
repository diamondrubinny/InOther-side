import { isoFromHebrew, type Locale } from "@inother/shared";

/** Civil date + its Hebrew date, localized ("21 April 2027 · 14 Nisan 5787"). */
export function formatDualDate(iso: string, locale: Locale, afterSunset = false): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const civil = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(d);
  const h = new Date(d.getTime() + (afterSunset ? 86_400_000 : 0));
  const hebrew = new Intl.DateTimeFormat(`${locale}-u-ca-hebrew`, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(h);
  return `${civil} · ${hebrew}`;
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

/** Localized Hebrew month names, 1 (Nisan) … 12 (Adar) … 13 (Adar II), via ICU. */
export function hebrewMonthNames(locale: Locale): { value: number; label: string }[] {
  const fmt = new Intl.DateTimeFormat(`${locale}-u-ca-hebrew`, { month: "long", timeZone: "UTC" });
  const name = (year: number, month: number) => fmt.format(new Date(`${isoFromHebrew({ year, month, day: 1 })}T12:00:00Z`));
  // Tishrei-first order, as the Hebrew year runs. 5785 is a common year (plain "Adar"), 5784 a leap year.
  const order = [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6];
  return order.map((m) => ({ value: m, label: m === 13 ? name(5784, 13) : name(5785, m) }));
}

export function gregorianMonthNames(locale: Locale): { value: number; label: string }[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: fmt.format(new Date(Date.UTC(2024, i, 15))) }));
}

/** "1961" | "1961-03" | "1961-03-07" → localized text at that precision. */
export function formatPartialDate(date: string, locale: Locale): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number | undefined, number | undefined];
  if (m === undefined) return String(y);
  const at = new Date(Date.UTC(y, m - 1, d ?? 1, 12));
  return new Intl.DateTimeFormat(locale, d === undefined ? { month: "long", year: "numeric", timeZone: "UTC" } : { dateStyle: "long", timeZone: "UTC" }).format(at);
}
