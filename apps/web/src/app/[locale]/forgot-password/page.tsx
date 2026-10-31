"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, TextField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const { messages } = useI18n();
  const t = messages.auth;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/password-reset/request", { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container section narrow">
      <form className="card stack" onSubmit={submit} noValidate>
        <h1>{t.forgotTitle}</h1>
        {sent ? (
          <Alert kind="success">{t.checkEmailText}</Alert>
        ) : (
          <>
            <p>{t.forgotText}</p>
            {error && <Alert kind="error">{error}</Alert>}
            <TextField label={t.email} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" busy={busy}>{t.sendReset}</Button>
          </>
        )}
      </form>
    </div>
  );
}
