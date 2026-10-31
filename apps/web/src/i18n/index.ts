import type { Locale } from "@inother/shared";
import ar from "./messages/ar";
import en from "./messages/en";
import es from "./messages/es";
import fr from "./messages/fr";
import he, { type Messages } from "./messages/he";
import ru from "./messages/ru";

export type { Messages };

const ALL: Record<Locale, Messages> = { he, en, ar, ru, fr, es };

export function getMessages(locale: Locale): Messages {
  return ALL[locale];
}

/** Replaces {name} placeholders. Values are inserted as text (React escapes them on render). */
export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** Translates an API error code, falling back to a generic message. */
export function errorMessage(messages: Messages, code: string | undefined): string {
  if (code && code in messages.errors) return messages.errors[code as keyof Messages["errors"]];
  return messages.errors.generic;
}
