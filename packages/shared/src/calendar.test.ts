import { describe, expect, it } from "vitest";
import {
  fixedFromIso,
  hebrewFromFixed,
  hebrewFromIso,
  isoFromFixed,
  isoFromHebrew,
  fixedFromHebrew,
  yahrzeitFixed,
  hebrewBirthday,
} from "./calendar/hebrew.js";
import { ageOn, isMinor, isoDateInTimeZone, nextOccurrence, upcomingOccurrences, type ScheduleContext } from "./calendar/schedule.js";
import { beneficiaryUpdateSchema, messageTriggerSchema, type MessageTrigger } from "./index.js";

const ICU_MONTHS: Record<string, number> = {
  Nisan: 1, Iyar: 2, Sivan: 3, Tamuz: 4, Av: 5, Elul: 6, Tishri: 7, Heshvan: 8, Kislev: 9, Tevet: 10, Shevat: 11, Adar: 12, "Adar I": 12, "Adar II": 13,
};

describe("Hebrew calendar arithmetic", () => {
  it("matches ICU for every day from 1900 to 2100", () => {
    const fmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const start = fixedFromIso("1900-01-01");
    const end = fixedFromIso("2100-12-31");
    let mismatches = 0;
    for (let f = start; f <= end; f++) {
      const iso = isoFromFixed(f);
      const p = fmt.formatToParts(new Date(`${iso}T00:00:00Z`));
      const icu = {
        year: Number(p.find((x) => x.type === "year")?.value),
        month: ICU_MONTHS[p.find((x) => x.type === "month")?.value ?? ""],
        day: Number(p.find((x) => x.type === "day")?.value),
      };
      const mine = hebrewFromFixed(f);
      if (mine.year !== icu.year || mine.month !== icu.month || mine.day !== icu.day) mismatches++;
      if (fixedFromHebrew(mine) !== f) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it("known dates", () => {
    expect(isoFromHebrew({ year: 5785, month: 7, day: 1 })).toBe("2024-10-03"); // Rosh Hashana 5785
    expect(hebrewFromIso("2024-03-24")).toEqual({ year: 5784, month: 13, day: 14 }); // Purim 5784 (leap)
    expect(hebrewFromIso("2024-03-23", true)).toEqual({ year: 5784, month: 13, day: 14 }); // after sunset
  });

  it("birthday rules: Adar of a common year falls in Adar II of a leap year (bar mitzvah rule)", () => {
    const common = { year: 5772, month: 12, day: 10 }; // 5772 common
    expect(hebrewBirthday(common, 5784).month).toBe(13);
    expect(hebrewBirthday({ year: 5784, month: 13, day: 5 }, 5785).month).toBe(12);
    expect(hebrewBirthday({ year: 5784, month: 12, day: 5 }, 5787).month).toBe(12); // Adar I stays Adar I
  });

  it("yahrzeit of 30 Cheshvan follows the first anniversary", () => {
    // Find a year with a long Cheshvan followed by a short one.
    const death = { year: 5783, month: 8, day: 30 };
    expect(isoFromFixed(fixedFromHebrew(death))).toMatch(/^2022-11-/);
    const y = yahrzeitFixed(death, 5784);
    const h = hebrewFromFixed(y);
    expect([h.month, h.day]).toEqual(fixedFromHebrew({ year: 5784, month: 8, day: 30 }) === fixedFromHebrew({ year: 5784, month: 9, day: 1 }) ? [8, 29] : [8, 30]);
    // Death in Adar II → Adar in a common year.
    expect(hebrewFromFixed(yahrzeitFixed({ year: 5784, month: 13, day: 1 }, 5785)).month).toBe(12);
  });
});

describe("schedule engine", () => {
  const ctx: ScheduleContext = { birthDate: "2015-02-20", deathDate: "2026-11-02", releaseDate: "2026-11-25" };
  const t = (x: unknown) => messageTriggerSchema.parse(x) as MessageTrigger;

  it("on release / fixed date / days after death (with catch-up)", () => {
    expect(nextOccurrence(t({ kind: "on_release" }), ctx, ctx.releaseDate, true)).toBe("2026-11-25");
    expect(nextOccurrence(t({ kind: "on_release" }), ctx, "2026-11-26", false)).toBeNull();
    expect(nextOccurrence(t({ kind: "date", date: "2030-09-01" }), ctx, ctx.releaseDate, true)).toBe("2030-09-01");
    expect(nextOccurrence(t({ kind: "date", date: "2020-01-01" }), ctx, ctx.releaseDate, true)).toBe("2026-11-25");
    // Shloshim passed during the waiting period → delivered on release day.
    expect(nextOccurrence(t({ kind: "after_death", days: 7 }), ctx, ctx.releaseDate, true)).toBe("2026-11-25");
    expect(nextOccurrence(t({ kind: "after_death", days: 30 }), ctx, ctx.releaseDate, true)).toBe("2026-12-02");
  });

  it("Gregorian and Hebrew birthdays, repeating", () => {
    expect(upcomingOccurrences(t({ kind: "birthday", calendar: "gregorian", repeat: true }), ctx)).toEqual(["2027-02-20", "2028-02-20", "2029-02-20"]);
    expect(upcomingOccurrences(t({ kind: "birthday", calendar: "gregorian", repeat: false }), ctx)).toEqual(["2027-02-20"]);
    const heb = upcomingOccurrences(t({ kind: "birthday", calendar: "hebrew", repeat: true }), ctx);
    const born = hebrewFromIso("2015-02-20"); // 1 Adar 5775 (common year)
    expect(born).toEqual({ year: 5775, month: 12, day: 1 });
    for (const d of heb) {
      const h = hebrewFromIso(d);
      expect(h.day).toBe(1);
      expect([12, 13]).toContain(h.month);
    }
    // 5787 is a leap year → Adar II
    expect(hebrewFromIso(heb[0] as string)).toMatchObject({ year: 5787, month: 13 });
  });

  it("Feb 29 birthdays fall on Feb 28 in common years", () => {
    const c = { ...ctx, birthDate: "2012-02-29" };
    expect(upcomingOccurrences(t({ kind: "birthday", calendar: "gregorian", repeat: true }), c)).toEqual(["2027-02-28", "2028-02-29", "2029-02-28"]);
  });

  it("bar mitzvah: Hebrew age 13", () => {
    const d = nextOccurrence(t({ kind: "age", calendar: "hebrew", age: 13 }), ctx, ctx.releaseDate, true) as string;
    expect(hebrewFromIso(d)).toEqual({ year: 5788, month: 12, day: 1 }); // 5788 is common
    // Already reached → delivered on release.
    expect(nextOccurrence(t({ kind: "age", calendar: "gregorian", age: 5 }), ctx, ctx.releaseDate, true)).toBe("2026-11-25");
    // No birth date → never.
    expect(nextOccurrence(t({ kind: "age", calendar: "gregorian", age: 18 }), { ...ctx, birthDate: null }, ctx.releaseDate, true)).toBeNull();
  });

  it("yahrzeit is the Hebrew anniversary of death; after sunset shifts it", () => {
    const y = upcomingOccurrences(t({ kind: "yahrzeit", repeat: true }), ctx);
    const death = hebrewFromIso("2026-11-02");
    for (const d of y) expect(hebrewFromIso(d)).toMatchObject({ month: death.month, day: death.day });
    expect(hebrewFromIso(y[0] as string).year).toBe(death.year + 1);
    const late = upcomingOccurrences(t({ kind: "yahrzeit", repeat: false }), { ...ctx, deathAfterSunset: true });
    expect(fixedFromIso(late[0] as string) - fixedFromIso(y[0] as string)).toBe(1);
  });

  it("holidays are delivered on the eve", () => {
    const pesach = upcomingOccurrences(t({ kind: "holiday", holiday: "pesach", repeat: true }), ctx, 2);
    expect(pesach.map((d) => hebrewFromIso(d))).toEqual([
      { year: 5787, month: 1, day: 14 },
      { year: 5788, month: 1, day: 14 },
    ]);
    const purim = nextOccurrence(t({ kind: "holiday", holiday: "purim", repeat: false }), ctx, ctx.releaseDate, true) as string;
    expect(hebrewFromIso(purim)).toEqual({ year: 5787, month: 13, day: 13 }); // leap year → Adar II
    const rh = nextOccurrence(t({ kind: "holiday", holiday: "rosh_hashana", repeat: false }), ctx, ctx.releaseDate, true) as string;
    expect(hebrewFromIso(rh)).toEqual({ year: 5787, month: 6, day: 29 });
  });

  it("custom annual dates and life events", () => {
    expect(upcomingOccurrences(t({ kind: "annual", calendar: "gregorian", month: 6, day: 15, repeat: true }), ctx, 2)).toEqual(["2027-06-15", "2028-06-15"]);
    const heb = upcomingOccurrences(t({ kind: "annual", calendar: "hebrew", month: 13, day: 10, repeat: true }), ctx, 2);
    expect(hebrewFromIso(heb[0] as string)).toMatchObject({ month: 13, day: 10 }); // 5787 leap
    expect(hebrewFromIso(heb[1] as string)).toMatchObject({ month: 12, day: 10 }); // 5788 common → Adar
    expect(nextOccurrence(t({ kind: "life_event", event: "wedding" }), ctx, ctx.releaseDate, true)).toBeNull();
  });

  it("validation", () => {
    expect(messageTriggerSchema.safeParse({ kind: "annual", calendar: "gregorian", month: 2, day: 30, repeat: true }).success).toBe(false);
    expect(messageTriggerSchema.safeParse({ kind: "annual", calendar: "gregorian", month: 13, day: 1, repeat: true }).success).toBe(false);
    expect(messageTriggerSchema.safeParse({ kind: "annual", calendar: "hebrew", month: 13, day: 30, repeat: true }).success).toBe(true);
    expect(messageTriggerSchema.safeParse({ kind: "life_event", event: "other" }).success).toBe(false);
    expect(messageTriggerSchema.safeParse({ kind: "life_event", event: "other", label: "Your first job" }).success).toBe(true);
  });

  it("partial beneficiary update does not inject defaults", () => {
    expect(beneficiaryUpdateSchema.parse({ name: "Dana" })).toEqual({ name: "Dana" });
  });

  it("age / minors / time zone", () => {
    expect(ageOn("2010-05-10", "2028-05-09")).toBe(17);
    expect(isMinor("2010-05-10", "2028-05-10")).toBe(false);
    expect(isMinor(null, "2028-05-10")).toBe(false);
    expect(isoDateInTimeZone(new Date("2026-11-01T23:30:00Z"), "Asia/Jerusalem")).toBe("2026-11-02");
  });
});
