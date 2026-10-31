"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CURRENT_TERMS_VERSION, PASSWORD_MIN_LENGTH } from "@inother/shared";
import { Alert, Button, Checkbox, TextField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { locale, messages } = useI18n();
  const t = messages.auth;
  const [form, setForm] = useState({ displayName: "", email: "", password: "", confirmAdult: false, acceptTerms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.displayName.trim()) errs.displayName = messages.common.required;
    if (!form.email.trim()) errs.email = messages.common.required;
    if (form.password.length < PASSWORD_MIN_LENGTH) errs.password = t.passwordHint;
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0 || !form.confirmAdult || !form.acceptTerms) {
      setError(messages.errors.validation_failed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/register", { ...form, termsVersion: CURRENT_TERMS_VERSION, locale });
      setSent(true);
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="container section narrow">
        <div className="card stack" role="status">
          <h1>{t.checkEmailTitle}</h1>
          <p>{t.checkEmailText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container section narrow">
      <form className="card stack" onSubmit={submit} noValidate>
        <h1>{t.registerTitle}</h1>
        {error && <Alert kind="error">{error}</Alert>}
        <TextField label={t.displayName} autoComplete="name" value={form.displayName} error={fieldErrors.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required maxLength={80} />
        <TextField label={t.email} type="email" autoComplete="email" value={form.email} error={fieldErrors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <TextField label={t.password} type="password" autoComplete="new-password" hint={t.passwordHint} value={form.password} error={fieldErrors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={PASSWORD_MIN_LENGTH} maxLength={128} />
        <Checkbox label={t.confirmAdult} checked={form.confirmAdult} onChange={(e) => setForm({ ...form, confirmAdult: e.target.checked })} required />
        <Checkbox
          label={
            <>
              {t.acceptTerms} (<Link href={`/${locale}/terms`} target="_blank">{messages.footer.terms}</Link>,{" "}
              <Link href={`/${locale}/privacy`} target="_blank">{messages.footer.privacy}</Link>)
            </>
          }
          checked={form.acceptTerms}
          onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })}
          required
        />
        <Button type="submit" busy={busy}>{t.submitRegister}</Button>
        <p className="small">
          {t.haveAccount} <Link href={`/${locale}/login`}>{messages.nav.login}</Link>
        </p>
      </form>
    </div>
  );
}
