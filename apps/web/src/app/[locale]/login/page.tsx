"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, TextField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { hasPendingInvite } from "@/lib/pending-invite";

type LoginResponse = { status: "authenticated" } | { status: "mfa_required"; challengeToken: string };

export default function LoginPage() {
  const { locale, messages } = useI18n();
  const t = messages.auth;
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    await refresh();
    // Came here from an invitation link? Go back to finish accepting it.
    router.push(hasPendingInvite() ? `/${locale}/invitation` : `/${locale}/app`);
  };

  const fail = (err: unknown) => setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<LoginResponse>("POST", "/auth/login", { email, password });
      if (res.status === "mfa_required") setChallenge(res.challengeToken);
      else await done();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/login/mfa", useRecovery ? { challengeToken: challenge, recoveryCode: code } : { challengeToken: challenge, code });
      await done();
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_or_expired_challenge") setChallenge(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container section narrow">
      {challenge === null ? (
        <form className="card stack" onSubmit={submitPassword} noValidate>
          <h1>{t.loginTitle}</h1>
          {error && <Alert kind="error">{error}</Alert>}
          <TextField label={t.email} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label={t.password} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" busy={busy}>{t.submitLogin}</Button>
          <p className="small">
            <Link href={`/${locale}/forgot-password`}>{t.forgot}</Link>
          </p>
          <p className="small">
            {t.noAccount} <Link href={`/${locale}/register`}>{messages.nav.register}</Link>
          </p>
        </form>
      ) : (
        <form className="card stack" onSubmit={submitMfa} noValidate>
          <h1>{t.mfaTitle}</h1>
          {error && <Alert kind="error">{error}</Alert>}
          {useRecovery ? (
            <TextField key="rc" label={t.recoveryCode} className="code-input" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
          ) : (
            <TextField
              key="otp"
              label={t.mfaCode}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
            />
          )}
          <Button type="submit" busy={busy}>{t.verify}</Button>
          <Button variant="link" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>
            {useRecovery ? t.useCode : t.useRecovery}
          </Button>
        </form>
      )}
    </div>
  );
}
