"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, Loading } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { readHashToken } from "@/lib/hash-token";
import { savePendingInvite, takePendingInvite } from "@/lib/pending-invite";
import { useDocumentTitle } from "@/lib/use-title";

export default function InvitationPage() {
  const { locale, messages } = useI18n();
  const t = messages.release;
  useDocumentTitle(t.invitationTitle);
  const { me, loading } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromHash = readHashToken();
    const tok = fromHash ?? takePendingInvite();
    if (tok) savePendingInvite(tok); // survive a sign-in redirect
    setToken(tok);
  }, []);

  const accept = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ kind: "executor" | "beneficiary"; legatorName: string }>("POST", "/invitations/accept", { token });
      takePendingInvite();
      setResult(format(res.kind === "executor" ? t.invitationAcceptedExecutor : t.invitationAcceptedBeneficiary, { name: res.legatorName }));
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container section narrow">
      <div className="card stack">
        <h1>{t.invitationTitle}</h1>
        {loading && <Loading />}
        {!loading && !token && <Alert kind="error">{messages.auth.missingToken}</Alert>}
        {!loading && token && !me && (
          <>
            <p>{t.invitationSignIn}</p>
            <div className="row">
              <Link className="btn" href={`/${locale}/login`}>{messages.nav.login}</Link>
              <Link className="btn secondary" href={`/${locale}/register`}>{messages.nav.register}</Link>
            </div>
          </>
        )}
        {!loading && token && me && !result && (
          <>
            {error && <Alert kind="error">{error}</Alert>}
            <div><Button onClick={accept} busy={busy}>{t.accept}</Button></div>
          </>
        )}
        {result && (
          <>
            <Alert kind="success">{result}</Alert>
            <Link className="btn" href={`/${locale}/app`}>{messages.nav.dashboard}</Link>
          </>
        )}
      </div>
    </div>
  );
}
