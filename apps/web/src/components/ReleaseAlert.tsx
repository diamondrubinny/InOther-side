"use client";

import { useState } from "react";
import { format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Button } from "./ui";

/** Shown to a legator whose death was reported: the most important "I'm alive" control. */
export function ReleaseAlert() {
  const { locale, messages } = useI18n();
  const t = messages.release;
  const { data, reload } = useApi<{ openReport: { status: string; waitUntil: string | null } | null }>("/vault/release");
  const [busy, setBusy] = useState(false);
  const report = data?.openReport;
  if (!report) return null;
  return (
    <div className="alert error stack" role="alert">
      <h2 style={{ fontSize: "1.15rem", margin: 0 }}>{t.alertTitle}</h2>
      <p style={{ margin: 0 }}>{t.alertText}</p>
      {report.waitUntil && <p style={{ margin: 0 }}>{format(t.alertWaiting, { date: new Date(report.waitUntil).toLocaleDateString(locale) })}</p>}
      <div>
        <Button
          variant="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("POST", "/vault/release/cancel");
              await reload();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.cancelButton}
        </Button>
      </div>
    </div>
  );
}
