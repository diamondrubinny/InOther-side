"use client";

import { CALENDARS, HOLIDAYS, LIFE_EVENTS, TRIGGER_KINDS, type MessageTrigger, type TriggerKind } from "@inother/shared";
import { Checkbox, SelectField, TextField } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { gregorianMonthNames, hebrewMonthNames } from "@/lib/dates";

/** Flat editor state covering every trigger kind (only the fields of the chosen kind are used). */
export interface TriggerDraft {
  kind: TriggerKind;
  date: string;
  calendar: (typeof CALENDARS)[number];
  repeat: boolean;
  age: number;
  days: number;
  holiday: (typeof HOLIDAYS)[number];
  month: number;
  day: number;
  event: (typeof LIFE_EVENTS)[number];
  label: string;
}

export const emptyTrigger: TriggerDraft = {
  kind: "on_release",
  date: "",
  calendar: "hebrew",
  repeat: true,
  age: 18,
  days: 30,
  holiday: "rosh_hashana",
  month: 7,
  day: 1,
  event: "wedding",
  label: "",
};

export function draftFromTrigger(t: MessageTrigger): TriggerDraft {
  return { ...emptyTrigger, ...t, label: t.kind === "life_event" ? (t.label ?? "") : "" } as TriggerDraft;
}

export function triggerFromDraft(d: TriggerDraft): MessageTrigger {
  switch (d.kind) {
    case "on_release":
      return { kind: "on_release" };
    case "date":
      return { kind: "date", date: d.date };
    case "birthday":
      return { kind: "birthday", calendar: d.calendar, repeat: d.repeat };
    case "age":
      return { kind: "age", calendar: d.calendar, age: d.age };
    case "yahrzeit":
      return { kind: "yahrzeit", repeat: d.repeat };
    case "after_death":
      return { kind: "after_death", days: d.days };
    case "holiday":
      return { kind: "holiday", holiday: d.holiday, repeat: d.repeat };
    case "annual":
      return { kind: "annual", calendar: d.calendar, month: d.month, day: d.day, repeat: d.repeat };
    case "life_event":
      return { kind: "life_event", event: d.event, label: d.event === "other" ? d.label.trim() || null : null };
  }
}

export function TriggerEditor({ value, onChange }: { value: TriggerDraft; onChange: (v: TriggerDraft) => void }) {
  const { locale, messages } = useI18n();
  const t = messages.letters;
  const set = (patch: Partial<TriggerDraft>) => onChange({ ...value, ...patch });
  const hasCalendar = value.kind === "birthday" || value.kind === "age" || value.kind === "annual";
  const hasRepeat = ["birthday", "yahrzeit", "holiday", "annual"].includes(value.kind);
  const months = value.calendar === "hebrew" ? hebrewMonthNames(locale) : gregorianMonthNames(locale);

  return (
    <fieldset className="stack">
      <legend className="visually-hidden">{t.whenLabel}</legend>
      <SelectField label={t.whenLabel} value={value.kind} onChange={(e) => set({ kind: e.target.value as TriggerKind })}>
        {TRIGGER_KINDS.map((k) => (
          <option key={k} value={k}>
            {t.kinds[k]}
          </option>
        ))}
      </SelectField>
      <div className="grid">
        {hasCalendar && (
          <SelectField
            label={t.calendarLabel}
            value={value.calendar}
            onChange={(e) => set({ calendar: e.target.value as TriggerDraft["calendar"], month: e.target.value === "hebrew" ? 7 : 1, day: 1 })}
          >
            {CALENDARS.map((c) => (
              <option key={c} value={c}>
                {t.calendars[c]}
              </option>
            ))}
          </SelectField>
        )}
        {value.kind === "date" && <TextField label={t.dateLabel} type="date" required value={value.date} onChange={(e) => set({ date: e.target.value })} />}
        {value.kind === "age" && (
          <TextField label={t.ageLabel} hint={t.ageHelp} type="number" min={1} max={120} value={value.age} onChange={(e) => set({ age: Number(e.target.value) })} />
        )}
        {value.kind === "after_death" && (
          <TextField label={t.daysLabel} hint={t.daysHelp} type="number" min={1} max={3650} value={value.days} onChange={(e) => set({ days: Number(e.target.value) })} />
        )}
        {value.kind === "holiday" && (
          <SelectField label={t.holidayLabel} hint={t.holidayNote} value={value.holiday} onChange={(e) => set({ holiday: e.target.value as TriggerDraft["holiday"] })}>
            {HOLIDAYS.map((h) => (
              <option key={h} value={h}>
                {t.holidays[h]}
              </option>
            ))}
          </SelectField>
        )}
        {value.kind === "annual" && (
          <>
            <SelectField label={t.monthLabel} hint={value.calendar === "hebrew" ? t.adarNote : undefined} value={value.month} onChange={(e) => set({ month: Number(e.target.value) })}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>
            <TextField label={t.dayLabel} type="number" min={1} max={value.calendar === "hebrew" ? 30 : 31} value={value.day} onChange={(e) => set({ day: Number(e.target.value) })} />
          </>
        )}
        {value.kind === "life_event" && (
          <SelectField label={t.eventLabel} hint={t.eventNote} value={value.event} onChange={(e) => set({ event: e.target.value as TriggerDraft["event"] })}>
            {LIFE_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {t.events[ev]}
              </option>
            ))}
          </SelectField>
        )}
        {value.kind === "life_event" && value.event === "other" && (
          <TextField label={t.otherLabel} required maxLength={120} value={value.label} onChange={(e) => set({ label: e.target.value })} />
        )}
      </div>
      {hasRepeat && <Checkbox label={t.repeat} checked={value.repeat} onChange={(e) => set({ repeat: e.target.checked })} />}
    </fieldset>
  );
}

/** One-line human description of a trigger, for lists. */
export function useDescribeTrigger() {
  const { messages } = useI18n();
  const t = messages.letters;
  return (tr: MessageTrigger): string => {
    const base = t.kinds[tr.kind];
    const parts: string[] = [base];
    if (tr.kind === "holiday") parts.push(t.holidays[tr.holiday]);
    if (tr.kind === "life_event") parts.push(tr.label ?? t.events[tr.event]);
    if (tr.kind === "age") parts.push(String(tr.age));
    if (tr.kind === "after_death") parts.push(String(tr.days));
    if (tr.kind === "date") parts.push(tr.date);
    if (tr.kind === "birthday" || tr.kind === "age" || tr.kind === "annual") parts.push(t.calendars[tr.calendar]);
    if ("repeat" in tr && tr.repeat) parts.push(t.everyYear);
    return parts.join(" · ");
  };
}
