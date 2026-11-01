"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { PersonaCardEditor } from "@/components/PersonaCardEditor";
import { Alert, Button, Loading, SelectField, TextField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError, fetchBlob } from "@/lib/api";
import type { MediaItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

interface Settings {
  vaultId: string;
  portraitMediaId: string | null;
  mouthX: number;
  mouthY: number;
  eyeY: number;
  eyeSpread: number;
  voiceStatus: "none" | "processing" | "ready" | "failed";
  sessionsLimit: number;
  minutesLimit: number;
  audioSamples: number;
}

export default function PersonaSettingsPage() {
  const { locale, messages } = useI18n();
  const t = messages.persona;
  useDocumentTitle(t.settingsTitle);
  const settings = useApi<Settings>("/persona/settings");
  const media = useApi<{ items: MediaItem[] }>("/vault/media");
  const consents = useApi<{ items: { purpose: string; withdrawnAt: string | null }[] }>("/me/consents");
  const [form, setForm] = useState<Settings | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fb, setFb] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);
  useEffect(() => {
    if (!form?.portraitMediaId) return setPreview(null);
    let url: string | null = null;
    fetchBlob(`/vault/media/${form.portraitMediaId}/content`).then((b) => setPreview((url = URL.createObjectURL(b)))).catch(() => setPreview(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [form?.portraitMediaId]);

  if (settings.loading || media.loading) return <Loading />;
  if (settings.error) return <Alert kind="error">{errorMessage(messages, settings.error.code)}</Alert>;
  if (!form) return <Loading />;

  const has = (p: string) => (consents.data?.items ?? []).some((c) => c.purpose === p && c.withdrawnAt === null);
  const images = (media.data?.items ?? []).filter((m) => m.kind === "image" && m.status === "clean");
  const fail = (err: unknown) => setFb({ kind: "error", text: errorMessage(messages, err instanceof ApiError ? err.code : undefined) });

  const save = async () => {
    setBusy(true);
    setFb(null);
    try {
      const res = await api<Settings>("PATCH", "/persona/settings", {
        portraitMediaId: form.portraitMediaId,
        mouthX: form.mouthX,
        mouthY: form.mouthY,
        eyeY: form.eyeY,
        eyeSpread: form.eyeSpread,
        sessionsLimit: form.sessionsLimit,
        minutesLimit: form.minutesLimit,
      });
      setForm(res);
      setFb({ kind: "success", text: messages.common.saved });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const pickMouth = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setForm({ ...form, mouthX: Math.round(((e.clientX - r.left) / r.width) * 1000), mouthY: Math.round(((e.clientY - r.top) / r.height) * 1000) });
  };

  return (
    <div className="stack">
      <h1>{t.settingsTitle}</h1>
      <p>{t.intro}</p>
      <p className="muted small">{messages.common.aiNotice}</p>
      {!has("ai_processing") && <Alert kind="warning">{t.consentNeeded} <Link href={`/${locale}/app/settings`}>{messages.nav.settings}</Link></Alert>}
      {fb && <Alert kind={fb.kind}>{fb.text}</Alert>}

      <section className="card stack" aria-labelledby="portrait-h">
        <h2 id="portrait-h">{t.portraitTitle}</h2>
        <p className="muted">{t.portraitHelp}</p>
        {!has("avatar_creation") && <p className="hint">{messages.settings.consentAvatar}</p>}
        {images.length === 0 ? (
          <p className="muted">{t.noImages}</p>
        ) : (
          <SelectField label={t.choosePortrait} value={form.portraitMediaId ?? ""} onChange={(e) => setForm({ ...form, portraitMediaId: e.target.value || null })}>
            <option value="">{messages.media.none}</option>
            {images.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id.slice(0, 8)}</option>)}
          </SelectField>
        )}
        {preview && (
          <>
            <p>{t.mouthHelp}</p>
            {/* Mouse convenience; the numeric fields below are the keyboard-accessible equivalent. */}
            <div className="portrait-picker" onClick={pickMouth} aria-hidden="true">
              <img src={preview} alt="" />
              <span className="mouth-dot" style={{ left: `${form.mouthX / 10}%`, top: `${form.mouthY / 10}%` }} />
              <span className="mouth-dot eye" style={{ left: `${(form.mouthX - form.eyeSpread) / 10}%`, top: `${form.eyeY / 10}%` }} />
              <span className="mouth-dot eye" style={{ left: `${(form.mouthX + form.eyeSpread) / 10}%`, top: `${form.eyeY / 10}%` }} />
            </div>
            <div className="grid">
              <TextField label={t.mouthX} type="number" min={0} max={1000} value={form.mouthX} onChange={(e) => setForm({ ...form, mouthX: Number(e.target.value) })} />
              <TextField label={t.mouthY} type="number" min={0} max={1000} value={form.mouthY} onChange={(e) => setForm({ ...form, mouthY: Number(e.target.value) })} />
            </div>
            <fieldset>
              <legend>{t.eyesTitle}</legend>
              <div className="grid">
                <TextField label={t.eyeY} type="number" min={0} max={1000} value={form.eyeY} onChange={(e) => setForm({ ...form, eyeY: Number(e.target.value) })} />
                <TextField label={t.eyeSpread} type="number" min={10} max={450} value={form.eyeSpread} onChange={(e) => setForm({ ...form, eyeSpread: Number(e.target.value) })} />
              </div>
            </fieldset>
          </>
        )}
      </section>

      {has("ai_processing") && <PersonaCardEditor />}

      <section className="card stack" aria-labelledby="voice-h">
        <h2 id="voice-h">{t.voiceTitle}</h2>
        <p className="muted">{t.voiceHelp}</p>
        <p>
          <span className={`badge ${form.voiceStatus === "ready" ? "ok" : ""}`}>{t.voiceStatuses[form.voiceStatus]}</span>
        </p>
        {!has("voice_cloning") && <p className="hint">{messages.errors.voice_not_consented}</p>}
        <div>
          <Button
            variant="secondary"
            busy={busy}
            disabled={!has("voice_cloning") || form.audioSamples === 0}
            onClick={async () => {
              setBusy(true);
              setFb(null);
              try {
                setForm(await api<Settings>("POST", "/persona/settings/voice"));
              } catch (err) {
                fail(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.cloneVoice}
          </Button>
        </div>
        {form.audioSamples === 0 && <p className="hint">{messages.errors.no_voice_samples}</p>}
      </section>

      <section className="card stack" aria-labelledby="limits-h">
        <h2 id="limits-h">{t.limitsTitle}</h2>
        <div className="grid">
          <TextField label={t.sessionsLimit} type="number" min={1} max={50} value={form.sessionsLimit} onChange={(e) => setForm({ ...form, sessionsLimit: Number(e.target.value) })} />
          <TextField label={t.minutesLimit} type="number" min={5} max={120} value={form.minutesLimit} onChange={(e) => setForm({ ...form, minutesLimit: Number(e.target.value) })} />
        </div>
      </section>

      <div className="row">
        <Button busy={busy} onClick={() => void save()}>{messages.common.save}</Button>
        {has("ai_processing") && <Link className="btn secondary" href={`/${locale}/app/persona/${form.vaultId}`}>{t.preview}</Link>}
      </div>
    </div>
  );
}
