import {
  fixedFromHebrew,
  fixedFromIso,
  hebrewBirthday,
  hebrewFromIso,
  hebrewFromFixed,
  isHebrewLeapYear,
  isoFromFixed,
  yahrzeitFixed,
  type HebrewDate,
} from "./hebrew.js";
import type { HolidayId, MessageTrigger } from "../schemas/messages.js";

/** Facts the schedule depends on. Dates are ISO (YYYY-MM-DD), civil dates in the schedule time zone. */
export interface ScheduleContext {
  /** Recipient's date of birth (optional; birthday/age triggers need it). */
  birthDate?: string | null;
  bornAfterSunset?: boolean;
  deathDate: string;
  deathAfterSunset?: boolean;
  /** Day the vault was released to beneficiaries. */
  releaseDate: string;
}

const NEVER = Number.NEGATIVE_INFINITY;

/** Hebrew date of each holiday in a given Hebrew year. */
export function holidayFixed(holiday: HolidayId, hebrewYear: number): number {
  const d = (month: number, day: number) => fixedFromHebrew({ year: hebrewYear, month, day });
  switch (holiday) {
    case "rosh_hashana":
      return d(7, 1);
    case "yom_kippur":
      return d(7, 10);
    case "sukkot":
      return d(7, 15);
    case "hanukkah":
      return d(9, 25);
    case "tu_bishvat":
      return d(11, 15);
    case "purim":
      return d(isHebrewLeapYear(hebrewYear) ? 13 : 12, 14);
    case "pesach":
      return d(1, 15);
    case "shavuot":
      return d(3, 6);
  }
}

function daysInGregorianMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** month/day in a Gregorian year; Feb 29 falls on Feb 28 in common years. */
function gregorianFixed(year: number, month: number, day: number): number {
  const d = Math.min(day, daysInGregorianMonth(year, month));
  return fixedFromIso(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
}

function firstGregorianAnnual(month: number, day: number, from: number, minYear = -Infinity): number | null {
  const y0 = Number(isoFromFixed(from).slice(0, 4));
  for (let y = y0; y <= y0 + 1; y++) {
    if (y < minYear) continue;
    const f = gregorianFixed(y, month, day);
    if (f >= from) return f;
  }
  return null;
}

function firstHebrewAnnual(at: (hebrewYear: number) => number, from: number): number | null {
  const hy0 = hebrewFromFixed(from).year;
  for (let hy = hy0 - 1; hy <= hy0 + 2; hy++) {
    const f = at(hy);
    if (f >= from) return f;
  }
  return null;
}

function annualHebrewFixed(month: number, day: number, year: number): number {
  const m = month === 13 && !isHebrewLeapYear(year) ? 12 : month;
  // Day 30 of a 29-day month naturally rolls over to the 1st of the next month.
  return fixedFromHebrew({ year, month: m, day });
}

function parts(iso: string) {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

/**
 * Next delivery day (ISO) for a trigger, on or after `from`; null = never (again).
 *
 * `initial` is true when the schedule is first computed at release: a one-time trigger whose day
 * already passed (e.g. "30 days after death" during the waiting period, or an age the recipient
 * already reached) is then delivered on `from` instead of being lost. Non-repeating triggers yield
 * nothing once `initial` is false (they were already delivered). "life_event" is opened by the
 * recipient, never automatically.
 */
export function nextOccurrence(trigger: MessageTrigger, ctx: ScheduleContext, from: string, initial: boolean): string | null {
  const fromFixed = fixedFromIso(from);
  const oneTime = (target: number | null): string | null => {
    if (!initial || target === null) return null;
    return isoFromFixed(Math.max(target, fromFixed));
  };
  const recurring = (repeat: boolean, find: () => number | null): string | null => {
    if (!initial && !repeat) return null;
    const f = find();
    return f === null ? null : isoFromFixed(f);
  };

  switch (trigger.kind) {
    case "on_release":
      return oneTime(fixedFromIso(ctx.releaseDate));
    case "date":
      return oneTime(fixedFromIso(trigger.date));
    case "after_death":
      return oneTime(fixedFromIso(ctx.deathDate) + trigger.days);
    case "life_event":
      return null;
    case "age": {
      if (!ctx.birthDate) return null;
      if (trigger.calendar === "gregorian") {
        const b = parts(ctx.birthDate);
        return oneTime(gregorianFixed(b.y + trigger.age, b.m, b.d));
      }
      const orig = hebrewFromIso(ctx.birthDate, ctx.bornAfterSunset);
      return oneTime(fixedFromHebrew(hebrewBirthday(orig, orig.year + trigger.age)));
    }
    case "birthday": {
      const birth = ctx.birthDate;
      if (!birth) return null;
      if (trigger.calendar === "gregorian") {
        const b = parts(birth);
        return recurring(trigger.repeat, () => firstGregorianAnnual(b.m, b.d, fromFixed, b.y + 1));
      }
      const orig: HebrewDate = hebrewFromIso(birth, ctx.bornAfterSunset);
      return recurring(trigger.repeat, () =>
        firstHebrewAnnual((hy) => (hy > orig.year ? fixedFromHebrew(hebrewBirthday(orig, hy)) : NEVER), fromFixed),
      );
    }
    case "yahrzeit": {
      const death = hebrewFromIso(ctx.deathDate, ctx.deathAfterSunset);
      return recurring(trigger.repeat, () => firstHebrewAnnual((hy) => (hy > death.year ? yahrzeitFixed(death, hy) : NEVER), fromFixed));
    }
    case "holiday":
      // Delivered on the eve: the civil day whose evening the holiday begins.
      return recurring(trigger.repeat, () => firstHebrewAnnual((hy) => holidayFixed(trigger.holiday, hy) - 1, fromFixed));
    case "annual":
      if (trigger.calendar === "gregorian") {
        return recurring(trigger.repeat, () => firstGregorianAnnual(trigger.month, trigger.day, fromFixed));
      }
      return recurring(trigger.repeat, () => firstHebrewAnnual((hy) => annualHebrewFixed(trigger.month, trigger.day, hy), fromFixed));
  }
}

/** The next `count` delivery days (for previews). */
export function upcomingOccurrences(trigger: MessageTrigger, ctx: ScheduleContext, count = 3): string[] {
  const out: string[] = [];
  let next = nextOccurrence(trigger, ctx, ctx.releaseDate, true);
  while (next && out.length < count) {
    out.push(next);
    next = nextOccurrence(trigger, ctx, isoFromFixed(fixedFromIso(next) + 1), false);
  }
  return out;
}

/** Whole years between a birth date and a day (Gregorian). */
export function ageOn(birthDate: string, onDate: string): number {
  const b = parts(birthDate);
  const o = parts(onDate);
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age--;
  return age;
}

export const ADULT_AGE = 18;
export function isMinor(birthDate: string | null | undefined, onDate: string): boolean {
  return !!birthDate && ageOn(birthDate, onDate) < ADULT_AGE;
}

/** Civil date (ISO) of an instant in an IANA time zone. */
export function isoDateInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
