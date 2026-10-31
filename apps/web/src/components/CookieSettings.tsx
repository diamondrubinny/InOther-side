"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { Dialog } from "./Dialog";
import { Button, Checkbox } from "./ui";

export const CONSENT_KEY = "inother_cookie_consent";
const POLICY_VERSION = "2026-10-draft-1";

interface Consent {
  analytics: boolean;
  version: string;
  decidedAt: string;
}

export function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Consent) : null;
    return parsed && parsed.version === POLICY_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Cookie & tracker preferences. Today the site uses ONLY essential cookies, so no banner is
 * forced on visitors; this dialog documents that and records a choice for any future
 * optional category. Nothing non-essential is ever loaded before an explicit "accept".
 * Reachable at all times from the footer ("Privacy & cookie settings").
 */
export function CookieSettings() {
  const { messages } = useI18n();
  const t = messages.cookies;
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    setAnalytics(readConsent()?.analytics ?? false);
  }, [open]);

  const save = (value: boolean) => {
    const consent: Consent = { analytics: value, version: POLICY_VERSION, decidedAt: new Date().toISOString() };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch {
      /* ignore */
    }
    setAnalytics(value);
    setOpen(false);
  };

  return (
    <>
      <Button variant="link" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {messages.footer.cookieSettings}
      </Button>
      <Dialog open={open} title={t.title} onClose={() => setOpen(false)}>
        <div className="stack">
          <p>{t.text}</p>
          <Checkbox label={t.essential} checked disabled />
          <p className="hint">{t.essentialText}</p>
          <Checkbox label={t.analytics} checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
          <p className="hint">{t.analyticsText}</p>
          {/* Reject is as prominent as accept. */}
          <div className="row">
            <Button variant="secondary" onClick={() => save(false)}>{t.rejectAll}</Button>
            <Button variant="secondary" onClick={() => save(true)}>{t.acceptAll}</Button>
            <Button onClick={() => save(analytics)}>{t.save}</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
