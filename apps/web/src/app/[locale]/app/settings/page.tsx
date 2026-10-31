"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LOCALE_INFO, RELEASE_WAIT_DAYS_MAX, RELEASE_WAIT_DAYS_MIN, SUPPORTED_LOCALES, type Locale } from "@inother/shared";
import { ConfirmDialog, ReauthDialog } from "@/components/Dialog";
import { Alert, Button, Checkbox, Loading, SelectField, TextArea, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me, VaultSummary } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

type Feedback = { kind: "success" | "error"; text: string } | null;

/** Runs a sensitive action; if the API asks for step-up auth, shows the re-auth dialog and retries. */
function useReauth() {
  const pending = useRef<(() => Promise<void>) | null>(null);
  const [open, setOpen] = useState(false);
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") {
        pending.current = action;
        setOpen(true);
        return;
      }
      throw err;
    }
  };
  /** Asks for re-authentication up front unless the session was re-authenticated recently. */
  const requireFresh = async (action: () => Promise<void> | void) => {
    const me = await api<Me>("GET", "/me");
    if (me.reauthValid) {
      await action();
      return;
    }
    pending.current = async () => {
      await action();
    };
    setOpen(true);
  };
  const onDone = async () => {
    setOpen(false);
    const action = pending.current;
    pending.current = null;
    if (action) await action();
  };
  return { run, requireFresh, open, onDone, close: () => setOpen(false) };
}

function ProfileSection() {
  const { messages } = useI18n();
  const t = messages.settings;
  const { me, refresh } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(me?.displayName ?? "");
  const [locale, setLocale] = useState<Locale>(me?.locale ?? "he");
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<Feedback>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFb(null);
    try {
      await api("PATCH", "/me", { displayName: name, locale });
      document.cookie = `inother_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      await refresh();
      setFb({ kind: "success", text: messages.common.saved });
      if (locale !== me?.locale) router.push(`/${locale}/app/settings`);
    } catch (err) {
      setFb({ kind: "error", text: errorMessage(messages, err instanceof ApiError ? err.code : undefined) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="profile-title" noValidate>
      <h2 id="profile-title">{t.profile}</h2>
      <TextField label={t.displayName} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      <SelectField label={t.language} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>{LOCALE_INFO[l].nativeName}</option>
        ))}
      </SelectField>
      {fb && <Alert kind={fb.kind}>{fb.text}</Alert>}
      <div><Button type="submit" busy={busy}>{messages.common.save}</Button></div>
    </form>
  );
}

function VaultSection() {
  const { messages } = useI18n();
  const t = messages.settings;
  const { data, loading, error } = useApi<VaultSummary>("/vault");
  const [form, setForm] = useState<{ releaseWaitDays: number; requireSecondExecutor: boolean; neverRelease: boolean; openingMessage: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<Feedback>(null);

  useEffect(() => {
    if (data) {
      setForm({
        releaseWaitDays: data.releaseWaitDays,
        requireSecondExecutor: data.requireSecondExecutor,
        neverRelease: data.neverRelease,
        openingMessage: data.openingMessage ?? "",
      });
    }
  }, [data]);

  if (loading) return <Loading />;
  if (error?.status === 404) return null; // no vault yet
  if (error || !form) return <Alert kind="error">{errorMessage(messages, error?.code)}</Alert>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFb(null);
    try {
      await api("PATCH", "/vault", { ...form, openingMessage: form.openingMessage.trim() || null });
      setFb({ kind: "success", text: messages.common.saved });
    } catch (err) {
      setFb({ kind: "error", text: errorMessage(messages, err instanceof ApiError ? err.code : undefined) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="vault-title" noValidate>
      <h2 id="vault-title">{t.vault}</h2>
      <TextField
        label={t.releaseWaitDays}
        hint={t.releaseWaitHelp}
        type="number"
        min={RELEASE_WAIT_DAYS_MIN}
        max={RELEASE_WAIT_DAYS_MAX}
        value={form.releaseWaitDays}
        onChange={(e) => setForm({ ...form, releaseWaitDays: Number(e.target.value) })}
      />
      <Checkbox label={t.requireSecondExecutor} checked={form.requireSecondExecutor} onChange={(e) => setForm({ ...form, requireSecondExecutor: e.target.checked })} />
      <Checkbox label={t.neverRelease} checked={form.neverRelease} onChange={(e) => setForm({ ...form, neverRelease: e.target.checked })} />
      <TextArea label={t.openingMessage} value={form.openingMessage} onChange={(e) => setForm({ ...form, openingMessage: e.target.value })} maxLength={5000} />
      {fb && <Alert kind={fb.kind}>{fb.text}</Alert>}
      <div><Button type="submit" busy={busy}>{messages.common.save}</Button></div>
    </form>
  );
}

function SecuritySection() {
  const { messages } = useI18n();
  const t = messages.settings;
  const { me, refresh, setMe } = useAuth();
  const router = useRouter();
  const { locale } = useI18n();
  const reauth = useReauth();
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [fb, setFb] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const sessions = useApi<{ items: { id: string; lastSeenAt: string; userAgent: string | null; current: boolean }[] }>("/me/sessions");

  const fail = (err: unknown) => setFb({ kind: "error", text: errorMessage(messages, err instanceof ApiError ? err.code : undefined) });

  const startMfa = () =>
    reauth.run(async () => {
      const res = await api<{ uri: string; secret: string }>("POST", "/auth/mfa/setup");
      setSetup({ qr: await QRCode.toDataURL(res.uri, { margin: 1, width: 200 }), secret: res.secret });
    }).catch(fail);

  const confirmMfa = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFb(null);
    try {
      await reauth.run(async () => {
        const res = await api<{ recoveryCodes: string[] }>("POST", "/auth/mfa/confirm", { code });
        setRecovery(res.recoveryCodes);
        setSetup(null);
        setCode("");
        await refresh();
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const disableMfa = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFb(null);
    try {
      await reauth.run(async () => {
        await api("POST", "/auth/mfa/disable", { code });
        setCode("");
        await refresh();
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFb(null);
    try {
      await api("POST", "/auth/password/change", pw);
      setPw({ currentPassword: "", newPassword: "" });
      setFb({ kind: "success", text: messages.common.saved });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="security-title">
      <h2 id="security-title">{t.security}</h2>
      {fb && <Alert kind={fb.kind}>{fb.text}</Alert>}

      <h3>
        {t.mfa}: <span className={`badge ${me?.mfaEnabled ? "ok" : ""}`}>{me?.mfaEnabled ? t.mfaOn : t.mfaOff}</span>
      </h3>
      {recovery && (
        <div className="alert warning stack" role="status">
          <h4 style={{ margin: 0 }}>{t.recoveryTitle}</h4>
          <p style={{ margin: 0 }}>{t.recoveryText}</p>
          <ul className="recovery-codes plain ltr">
            {recovery.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div><Button small variant="secondary" onClick={() => setRecovery(null)}>{messages.common.close}</Button></div>
        </div>
      )}
      {!me?.mfaEnabled && !setup && <div><Button variant="secondary" onClick={() => void startMfa()}>{t.mfaEnable}</Button></div>}
      {setup && (
        <form className="stack" onSubmit={confirmMfa} noValidate>
          <p>{t.mfaScan}</p>
          <img className="qr" src={setup.qr} alt={t.mfaScan} />
          <p>
            {t.mfaManual} <code className="ltr">{setup.secret}</code>
          </p>
          <TextField label={messages.auth.mfaCode} inputMode="numeric" autoComplete="one-time-code" className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
          <div><Button type="submit" busy={busy}>{t.mfaConfirm}</Button></div>
        </form>
      )}
      {me?.mfaEnabled && (
        <form className="stack" onSubmit={disableMfa} noValidate>
          <TextField label={messages.auth.mfaCode} inputMode="numeric" autoComplete="one-time-code" className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
          <div><Button type="submit" variant="secondary" busy={busy}>{t.mfaDisable}</Button></div>
        </form>
      )}

      <h3>{t.changePassword}</h3>
      <form className="stack" onSubmit={changePassword} noValidate>
        <TextField label={t.currentPassword} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
        <TextField label={t.newPassword} type="password" autoComplete="new-password" hint={messages.auth.passwordHint} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
        <div><Button type="submit" busy={busy}>{t.changePassword}</Button></div>
      </form>

      <h3>{t.sessions}</h3>
      {sessions.loading ? (
        <Loading />
      ) : (
        <ul className="plain">
          {(sessions.data?.items ?? []).map((s) => (
            <li key={s.id} className="small">
              <span className="ltr">{s.userAgent?.slice(0, 80) ?? "—"}</span>
              {s.current && <span className="badge ok"> {t.currentSession}</span>}
              <div className="muted">{format(t.lastSeen, { date: new Date(s.lastSeenAt).toLocaleString(locale) })}</div>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          variant="secondary"
          onClick={async () => {
            await api("POST", "/auth/logout-all").catch(() => {});
            setMe(null);
            router.replace(`/${locale}/login`);
          }}
        >
          {t.logoutAll}
        </Button>
      </div>
      <ReauthDialog open={reauth.open} mfaEnabled={me?.mfaEnabled ?? false} onDone={() => void reauth.onDone().catch(fail)} onClose={reauth.close} />
    </section>
  );
}

function PrivacySection() {
  const { locale, messages } = useI18n();
  const t = messages.settings;
  const { me, setMe } = useAuth();
  const router = useRouter();
  const reauth = useReauth();
  const consents = useApi<{ items: { purpose: string; withdrawnAt: string | null }[] }>("/me/consents");
  const [fb, setFb] = useState<Feedback>(null);
  const [confirm, setConfirm] = useState<"vault" | "account" | null>(null);

  const active = (purpose: string) => (consents.data?.items ?? []).some((c) => c.purpose === purpose && c.withdrawnAt === null);
  const fail = (err: unknown) => setFb({ kind: "error", text: errorMessage(messages, err instanceof ApiError ? err.code : undefined) });

  const toggle = async (purpose: string, granted: boolean) => {
    try {
      await api("POST", "/me/consents", { purpose, granted });
      await consents.reload();
    } catch (err) {
      fail(err);
    }
  };

  const exportData = () =>
    reauth.run(async () => {
      const data = await api("GET", "/me/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch(fail);

  /** Destructive actions need a fresh re-auth first, then a typed confirmation. */
  const askDelete = (what: "vault" | "account") => reauth.requireFresh(() => setConfirm(what));

  return (
    <section className="card stack" aria-labelledby="privacy-title">
      <h2 id="privacy-title">{t.privacy}</h2>
      {fb && <Alert kind={fb.kind}>{fb.text}</Alert>}
      <fieldset>
        <legend>{t.consents}</legend>
        {[
          ["voice_cloning", t.consentVoice],
          ["avatar_creation", t.consentAvatar],
          ["ai_processing", t.consentAi],
        ].map(([purpose, label]) => (
          <Checkbox key={purpose} label={label} checked={active(purpose as string)} onChange={(e) => void toggle(purpose as string, e.target.checked)} />
        ))}
      </fieldset>

      <h3>{t.export}</h3>
      <p className="muted">{t.exportText}</p>
      <div><Button variant="secondary" onClick={() => void exportData()}>{t.export}</Button></div>

      <h3>{t.dangerZone}</h3>
      <p className="muted">{t.deleteVaultText}</p>
      <div><Button variant="danger" onClick={() => void askDelete("vault").catch(fail)}>{t.deleteVault}</Button></div>
      <p className="muted">{t.deleteAccountText}</p>
      <div><Button variant="danger" onClick={() => void askDelete("account").catch(fail)}>{t.deleteAccount}</Button></div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "account" ? t.deleteAccount : t.deleteVault}
        message={confirm === "account" ? t.deleteAccountText : t.deleteVaultText}
        confirmLabel={messages.common.delete}
        requireWord={t.confirmWord}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          // If the re-auth window expired meanwhile, the dialog shows "reauth_required".
          if (confirm === "account") {
            await api("DELETE", "/me");
            setMe(null);
            router.replace(`/${locale}`);
          } else {
            await api("DELETE", "/vault");
            router.replace(`/${locale}/app`);
          }
        }}
      />
      <ReauthDialog open={reauth.open} mfaEnabled={me?.mfaEnabled ?? false} onDone={() => void reauth.onDone().catch(fail)} onClose={reauth.close} />
    </section>
  );
}

export default function SettingsPage() {
  const { messages } = useI18n();
  useDocumentTitle(messages.settings.title);
  return (
    <div className="stack">
      <h1>{messages.settings.title}</h1>
      <ProfileSection />
      <VaultSection />
      <SecuritySection />
      <PrivacySection />
    </div>
  );
}
