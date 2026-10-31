"use client";

import { useEffect } from "react";
import { useI18n } from "@/i18n/client";

/** Sets a unique, descriptive page title (WCAG 2.4.2) for client-rendered pages. */
export function useDocumentTitle(title: string): void {
  const { messages } = useI18n();
  useEffect(() => {
    document.title = `${title} | ${messages.meta.siteName}`;
  }, [title, messages.meta.siteName]);
}
