"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@inother/shared";
import { Alert, Button, TextField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { readHashToken } from "@/lib/hash-token";

export default function ResetPasswordPage() {
  const { locale, messages } = useI18n();
  const t = messages.auth;
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(readHashToken());
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/password-reset/confirm", { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container section narrow">
      <form className="card stack" onSubmit={submit} noValidate>
        <h1>{t.resetTitle}</h1>
        {token === null && <Alert kind="error">{t.missingToken}</Alert>}
        {done ? (
          <>
            <Alert kind="success">{t.resetDone}</Alert>
            <Link className="btn" href={`/${locale}/login`}>{messages.nav.login}</Link>
          </>
        ) : (
          token && (
            <>
              {error && <Alert kind="error">{error}</Alert>}
              <TextField label={t.newPassword} type="password" autoComplete="new-password" hint={t.passwordHint} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={PASSWORD_MIN_LENGTH} />
              <Button type="submit" busy={busy}>{messages.common.save}</Button>
            </>
          )
        )}
      </form>
    </div>
  );
}
