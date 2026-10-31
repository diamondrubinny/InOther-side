"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@inother/shared";
import type { Messages } from "./index";

interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  messages: Messages;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ value, children }: { value: I18nValue; children: ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
