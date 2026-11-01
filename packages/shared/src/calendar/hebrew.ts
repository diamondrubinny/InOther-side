/**
 * Dependency-free Hebrew calendar arithmetic (after Reingold & Dershowitz, "Calendrical Calculations").
 * Dates are handled as "fixed" day numbers (R.D.: 1 = Jan 1, year 1, proleptic Gregorian).
 * Verified against ICU (Intl, calendar "hebrew") day by day in calendar.test.ts.
 *
 * Month numbering: Nisan = 1 ... Elul = 6, Tishrei = 7 ... Shevat = 11, Adar (Adar I in leap years) = 12,
 * Adar II = 13 (leap years only). The year starts at Tishrei (7).
 */

export const HebrewMonth = {
  NISAN: 1,
  IYYAR: 2,
  SIVAN: 3,
  TAMMUZ: 4,
  AV: 5,
  ELUL: 6,
  TISHREI: 7,
  CHESHVAN: 8,
  KISLEV: 9,
  TEVET: 10,
  SHEVAT: 11,
  ADAR: 12,
  ADAR_II: 13,
} as const;

export interface HebrewDate {
  year: number;
  month: number;
  day: number;
}

const HEBREW_EPOCH = -1373427; // fixed date of 1 Tishrei AM 1
const UNIX_EPOCH_FIXED = 719163; // fixed date of 1970-01-01
const DAY_MS = 86_400_000;

const mod = (a: number, b: number) => ((a % b) + b) % b;

export function isHebrewLeapYear(year: number): boolean {
  return mod(7 * year + 1, 19) < 7;
}

export function monthsInHebrewYear(year: number): number {
  return isHebrewLeapYear(year) ? 13 : 12;
}

function elapsedDays(year: number): number {
  const monthsElapsed = Math.floor((235 * year - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  const days = 29 * monthsElapsed + Math.floor(partsElapsed / 25920);
  return mod(3 * (days + 1), 7) < 3 ? days + 1 : days;
}

function yearLengthCorrection(year: number): number {
  const ny0 = elapsedDays(year - 1);
  const ny1 = elapsedDays(year);
  const ny2 = elapsedDays(year + 1);
  if (ny2 - ny1 === 356) return 2;
  if (ny1 - ny0 === 382) return 1;
  return 0;
}

const newYearCache = new Map<number, number>();
function newYear(year: number): number {
  let v = newYearCache.get(year);
  if (v === undefined) {
    v = HEBREW_EPOCH + elapsedDays(year) + yearLengthCorrection(year);
    newYearCache.set(year, v);
  }
  return v;
}

export function daysInHebrewYear(year: number): number {
  return newYear(year + 1) - newYear(year);
}

/** Cheshvan has 30 days. */
export function isLongCheshvan(year: number): boolean {
  const d = daysInHebrewYear(year);
  return d === 355 || d === 385;
}

/** Kislev has 29 days. */
export function isShortKislev(year: number): boolean {
  const d = daysInHebrewYear(year);
  return d === 353 || d === 383;
}

export function daysInHebrewMonth(month: number, year: number): number {
  if ([2, 4, 6, 10, 13].includes(month)) return 29;
  if (month === 12 && !isHebrewLeapYear(year)) return 29;
  if (month === 8 && !isLongCheshvan(year)) return 29;
  if (month === 9 && isShortKislev(year)) return 29;
  return 30;
}

export function fixedFromHebrew({ year, month, day }: HebrewDate): number {
  let fixed = newYear(year) + day - 1;
  if (month < 7) {
    for (let m = 7; m <= monthsInHebrewYear(year); m++) fixed += daysInHebrewMonth(m, year);
    for (let m = 1; m < month; m++) fixed += daysInHebrewMonth(m, year);
  } else {
    for (let m = 7; m < month; m++) fixed += daysInHebrewMonth(m, year);
  }
  return fixed;
}

export function hebrewFromFixed(fixed: number): HebrewDate {
  const approx = Math.floor((fixed - HEBREW_EPOCH) / (35975351 / 98496)) + 1;
  let year = approx - 1;
  while (newYear(year + 1) <= fixed) year++;
  let month = fixed < fixedFromHebrew({ year, month: 1, day: 1 }) ? 7 : 1;
  while (fixed > fixedFromHebrew({ year, month, day: daysInHebrewMonth(month, year) })) month++;
  const day = fixed - fixedFromHebrew({ year, month, day: 1 }) + 1;
  return { year, month, day };
}

// ---------------------------------------------------------------------------
// ISO (YYYY-MM-DD) <-> fixed
// ---------------------------------------------------------------------------

export function fixedFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error("invalid ISO date");
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS) + UNIX_EPOCH_FIXED;
}

export function isoFromFixed(fixed: number): string {
  return new Date((fixed - UNIX_EPOCH_FIXED) * DAY_MS).toISOString().slice(0, 10);
}

/** Hebrew date of a civil date; after sunset the Hebrew day has already advanced. */
export function hebrewFromIso(iso: string, afterSunset = false): HebrewDate {
  return hebrewFromFixed(fixedFromIso(iso) + (afterSunset ? 1 : 0));
}

export function isoFromHebrew(date: HebrewDate): string {
  return isoFromFixed(fixedFromHebrew(date));
}

// ---------------------------------------------------------------------------
// Anniversaries (customary rules, as implemented by Hebcal)
// ---------------------------------------------------------------------------

/**
 * Hebrew birthday (or other personal anniversary) of `orig` in Hebrew `year`.
 *  - born in Adar of a common year, or Adar II of a leap year → the last Adar of `year`
 *  - 30 Cheshvan / 30 Kislev missing in `year` → 1 Kislev / 1 Tevet
 *  - 30 Adar I (leap) in a common year → 1 Nisan
 */
export function hebrewBirthday(orig: HebrewDate, year: number): HebrewDate {
  const origLeap = isHebrewLeapYear(orig.year);
  let { month, day } = orig;
  if ((month === 12 && !origLeap) || (month === 13 && origLeap)) {
    month = monthsInHebrewYear(year);
  } else if (month === 8 && day === 30 && !isLongCheshvan(year)) {
    month = 9;
    day = 1;
  } else if (month === 9 && day === 30 && isShortKislev(year)) {
    month = 10;
    day = 1;
  } else if (month === 12 && day === 30 && origLeap && !isHebrewLeapYear(year)) {
    month = 1;
    day = 1;
  }
  return { year, month, day: Math.min(day, daysInHebrewMonth(month, year)) };
}

/**
 * Yahrzeit (anniversary of death) of `death` in Hebrew `year` (> death.year). Returns a fixed date.
 * NOTE: customs differ for a death in Adar of a common year (Adar I vs Adar II in leap years);
 * this follows Hebcal (Adar I). Requires rabbinic/professional confirmation before launch.
 */
export function yahrzeitFixed(death: HebrewDate, year: number): number {
  let { month, day } = death;
  if (month === 8 && day === 30 && !isLongCheshvan(death.year + 1)) {
    // Depends on the first anniversary: if that had no 30 Cheshvan, use the day before 1 Kislev.
    return fixedFromHebrew({ year, month: 9, day: 1 }) - 1;
  }
  if (month === 9 && day === 30 && isShortKislev(death.year + 1)) {
    return fixedFromHebrew({ year, month: 10, day: 1 }) - 1;
  }
  if (month === 13) {
    month = monthsInHebrewYear(year);
  } else if (month === 12 && day === 30 && !isHebrewLeapYear(year)) {
    month = 11;
    day = 30;
  }
  if (month === 8 && day === 30 && !isLongCheshvan(year)) {
    month = 9;
    day = 1;
  } else if (month === 9 && day === 30 && isShortKislev(year)) {
    month = 10;
    day = 1;
  }
  return fixedFromHebrew({ year, month, day });
}
