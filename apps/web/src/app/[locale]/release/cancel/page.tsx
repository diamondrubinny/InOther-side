"use client";

import { useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { readHashToken } from "@/lib/hash-token";
import { useDocumentTitle } from "@/lib/use-title";

/** "I'm alive" link from the email. Works without signing in. */
export default function CancelReleasePage() {
  const { messages } = useI18n();
  const t = messages.release;
  useDocumentTitle(t.cancelTitle);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setToken(readHashToken());
  }, []);

  return (
    <div className="container section narrow">
      <div className="card stack">
        <h1>{t.cancelTitle}</h1>
        {token === null && <Alert kind="error">{messages.auth.missingToken}</Alert>}
        {token && !done && (
          <>
            <p>{t.cancelText}</p>
            {error && <Alert kind="error">{error}</Alert>}
            <div>
              <Button
                variant="danger"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api("POST", "/release/cancel", { token });
                    setDone(true);
                  } catch (err) {
                    setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t.cancelButton}
              </Button>
            </div>
          </>
        )}
        {done && <Alert kind="success">{t.cancelled}</Alert>}
      </div>
    </div>
  );
}
