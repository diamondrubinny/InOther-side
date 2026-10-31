"use client";

import { useI18n } from "@/i18n/client";

/** Error boundary: friendly message, no technical details (they are only in server logs). */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { messages } = useI18n();
  return (
    <div className="container section narrow" role="alert">
      <h1>{messages.errorPage.title}</h1>
      <p>{messages.errorPage.text}</p>
      <button type="button" className="btn" onClick={reset}>{messages.common.retry}</button>
    </div>
  );
}
