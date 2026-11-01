import { z } from "zod";

export const CALENDARS = ["gregorian", "hebrew"] as const;
export const HOLIDAYS = ["rosh_hashana", "yom_kippur", "sukkot", "hanukkah", "tu_bishvat", "purim", "pesach", "shavuot"] as const;
export type HolidayId = (typeof HOLIDAYS)[number];
export const LIFE_EVENTS = ["wedding", "child_birth", "graduation", "army_service", "bar_mitzvah", "hard_time", "other"] as const;
export type LifeEvent = (typeof LIFE_EVENTS)[number];
export const TRIGGER_KINDS = ["on_release", "date", "birthday", "age", "yahrzeit", "after_death", "holiday", "annual", "life_event"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

const calendar = z.enum(CALENDARS);

export const messageTriggerSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("on_release") }),
    z.object({ kind: z.literal("date"), date: z.iso.date() }),
    z.object({ kind: z.literal("birthday"), calendar, repeat: z.boolean() }),
    z.object({ kind: z.literal("age"), calendar, age: z.number().int().min(1).max(120) }),
    z.object({ kind: z.literal("yahrzeit"), repeat: z.boolean() }),
    z.object({ kind: z.literal("after_death"), days: z.number().int().min(1).max(3650) }),
    z.object({ kind: z.literal("holiday"), holiday: z.enum(HOLIDAYS), repeat: z.boolean() }),
    z.object({
      kind: z.literal("annual"),
      calendar,
      month: z.number().int().min(1).max(13),
      day: z.number().int().min(1).max(31),
      repeat: z.boolean(),
    }),
    z.object({ kind: z.literal("life_event"), event: z.enum(LIFE_EVENTS), label: z.string().trim().min(1).max(120).nullable().default(null) }),
  ])
  .superRefine((t, ctx) => {
    if (t.kind === "annual") {
      const maxMonth = t.calendar === "gregorian" ? 12 : 13;
      const maxDay = t.calendar === "gregorian" ? new Date(Date.UTC(2024, t.month, 0)).getUTCDate() : 30;
      if (t.month > maxMonth) ctx.addIssue({ code: "custom", path: ["month"], message: "invalid_month" });
      else if (t.day > maxDay) ctx.addIssue({ code: "custom", path: ["day"], message: "invalid_day" });
    }
    if (t.kind === "life_event" && t.event === "other" && !t.label) {
      ctx.addIssue({ code: "custom", path: ["label"], message: "label_required" });
    }
  });
export type MessageTrigger = z.infer<typeof messageTriggerSchema>;

/** Triggers that depend on the recipient's date of birth. */
export function triggerNeedsBirthDate(t: MessageTrigger): boolean {
  return t.kind === "birthday" || t.kind === "age";
}

export const scheduledMessageInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  beneficiaryIds: z.array(z.uuid()).min(1).max(50),
  trigger: messageTriggerSchema,
  /** Optional clean media from the vault (audio/video/photo), revealed only with the message. */
  mediaId: z.uuid().nullable().default(null),
});
export type ScheduledMessageInput = z.infer<typeof scheduledMessageInputSchema>;

export const messagesPauseSchema = z.object({ paused: z.boolean() });
