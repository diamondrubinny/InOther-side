"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Relation } from "@inother/shared";
import { ConfirmDialog } from "@/components/Dialog";
import { Alert, Button, Checkbox, EmptyState, Loading, RadioGroup, SelectField, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

type LinkStatus = "active" | "used" | "revoked" | "expired";
interface LinkItem {
  id: string;
  question: string;
  status: LinkStatus;
  createdVia: "manual" | "weekly";
  expiresAt: string;
  createdAt: string;
}
interface Suggestion {
  id: string;
  text: string;
  status: "pending" | "accepted" | "dismissed" | "answered";
  from: string;
  relation: Relation;
}

function NewLink({ onCreated }: { onCreated: () => Promise<void> }) {
  const { locale, messages } = useI18n();
  const t = messages.capture;
  const [source, setSource] = useState<"catalog" | "custom">("catalog");
  const [text, setText] = useState("");
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; question: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (source === "custom" && text.trim().length < 3) {
      setError(messages.errors.validation_failed);
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const body = source === "custom" ? { source, text, sendToMyEmail: email } : { source, sendToMyEmail: email };
      setCreated(await api<{ url: string; question: string }>("POST", `/vault/capture-links?locale=${locale}`, body));
      setText("");
      await onCreated();
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="new-link-h">
      <h2 id="new-link-h">{t.newLink}</h2>
      <form className="stack" onSubmit={submit} noValidate aria-labelledby="new-link-h">
        <RadioGroup
          legend={t.sourceLabel}
          name="capture-source"
          value={source}
          onChange={setSource}
          options={[
            { value: "catalog", label: t.sources.catalog },
            { value: "custom", label: t.sources.custom },
          ]}
        />
        {source === "custom" && <TextField label={t.customLabel} required maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />}
        <Checkbox label={t.sendToMyEmail} checked={email} onChange={(e) => setEmail(e.target.checked)} />
        {error && <Alert kind="error">{error}</Alert>}
        <div>
          <Button type="submit" busy={busy}>{t.create}</Button>
        </div>
      </form>
      {created && (
        <div className="stack" role="status">
          <p>
            <strong>{t.created}</strong>
          </p>
          <p className="muted">„{created.question}”</p>
          <TextField label={t.linkLabel} readOnly value={created.url} className="ltr" onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? t.copied : t.copy}
            </Button>
          </div>
          <p className="muted small">{t.linkOnce}</p>
        </div>
      )}
    </section>
  );
}

function Weekly() {
  const { locale, messages } = useI18n();
  const t = messages.capture;
  const prefs = useApi<{ weeklyEnabled: boolean; weekday: number }>("/vault/capture-preferences");
  const [form, setForm] = useState<{ weeklyEnabled: boolean; weekday: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (prefs.data) setForm(prefs.data);
  }, [prefs.data]);
  const days = Array.from({ length: 7 }, (_, i) => ({
    value: i,
    // 2024-01-07 was a Sunday.
    label: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + i))),
  }));
  if (!form) return <Loading />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    try {
      await api("PUT", "/vault/capture-preferences", form);
      setStatus(t.weeklySaved);
    } catch (err) {
      setStatus(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    }
  };
  return (
    <section className="card stack" aria-labelledby="weekly-h">
      <h2 id="weekly-h">{t.weeklyTitle}</h2>
      <p className="muted">{t.weeklyHelp}</p>
      <form className="stack" onSubmit={save} noValidate aria-labelledby="weekly-h">
        <Checkbox label={t.weeklyEnabled} checked={form.weeklyEnabled} onChange={(e) => setForm({ ...form, weeklyEnabled: e.target.checked })} />
        {form.weeklyEnabled && (
          <div className="grid">
            <SelectField label={t.weekdayLabel} value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
              {days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        <div className="row">
          <Button type="submit">{messages.common.save}</Button>
          <span role="status" className="muted">{status}</span>
        </div>
      </form>
    </section>
  );
}

function Suggestions({ onLink }: { onLink: () => Promise<void> }) {
  const { locale, messages } = useI18n();
  const t = messages.capture;
  const list = useApi<{ items: Suggestion[] }>("/vault/suggestions");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await list.reload();
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    }
  };
  return (
    <section className="card stack" aria-labelledby="sugg-h">
      <h2 id="sugg-h">{t.suggestionsTitle}</h2>
      <p className="muted">{t.suggestionsHelp}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {list.loading && <Loading />}
      {list.data && list.data.items.length === 0 && <EmptyState>{t.noSuggestions}</EmptyState>}
      {list.data && list.data.items.length > 0 && (
        <ul className="plain stack">
          {list.data.items.map((s) => (
            <li key={s.id} className="stack" style={{ gap: "0.4rem" }}>
              <span style={{ display: "grid", gap: "0.2rem" }}>
                <strong>„{s.text}”</strong>
                <span className="muted small">
                  {format(t.suggestionFrom, { name: s.from })} · {messages.people.relations[s.relation]} ·{" "}
                  <span className={`badge ${s.status === "answered" ? "ok" : ""}`}>{t.suggestionStatuses[s.status]}</span>
                </span>
              </span>
              {s.status !== "answered" && (
                <span className="row">
                  {s.status !== "accepted" && (
                    <Button small variant="secondary" onClick={() => void act(() => api("POST", `/vault/suggestions/${s.id}/accept`))}>
                      {t.accept}
                      <span className="visually-hidden">: {s.text}</span>
                    </Button>
                  )}
                  {s.status !== "dismissed" && <Button
                    small
                    variant="secondary"
                    onClick={() =>
                      void act(async () => {
                        const link = await api<{ url: string }>("POST", `/vault/capture-links?locale=${locale}`, { source: "suggestion", suggestionId: s.id });
                        setCreated({ id: s.id, url: link.url });
                        await onLink();
                      })
                    }
                  >
                    {t.answerNow}
                    <span className="visually-hidden">: {s.text}</span>
                  </Button>}
                  {s.status !== "dismissed" && (
                    <Button small variant="link" onClick={() => void act(() => api("POST", `/vault/suggestions/${s.id}/dismiss`))}>
                      {t.dismiss}
                      <span className="visually-hidden">: {s.text}</span>
                    </Button>
                  )}
                </span>
              )}
              {created?.id === s.id && (
                <div role="status" className="stack">
                  <TextField label={t.linkLabel} readOnly value={created.url} className="ltr" onFocus={(e) => e.currentTarget.select()} />
                  <p className="muted small">{t.linkOnce}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CaptureAdminPage() {
  const { locale, messages } = useI18n();
  const t = messages.capture;
  useDocumentTitle(t.title);
  const links = useApi<{ items: LinkItem[] }>(`/vault/capture-links?locale=${locale}`);
  const [toRevoke, setToRevoke] = useState<LinkItem | null>(null);

  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      <Alert kind="warning">{t.warning}</Alert>
      <NewLink onCreated={links.reload} />
      <Suggestions onLink={links.reload} />
      <Weekly />
      <section className="card stack" aria-labelledby="links-h">
        <h2 id="links-h">{t.linksTitle}</h2>
        {links.loading && <Loading />}
        {links.error && <Alert kind="error">{errorMessage(messages, links.error.code)}</Alert>}
        {links.data && links.data.items.length === 0 && <EmptyState>{t.noLinks}</EmptyState>}
        {links.data && links.data.items.length > 0 && (
          <ul className="plain">
            {links.data.items.map((l) => (
              <li key={l.id} className="row spread">
                <span style={{ display: "grid", gap: "0.2rem" }}>
                  <span>„{l.question}”</span>
                  <span className="muted small">
                    <span className={`badge ${l.status === "used" ? "ok" : ""}`}>{t.statuses[l.status]}</span>
                    {l.createdVia === "weekly" ? ` · ${t.weekly}` : ""} · {formatDate(l.createdAt.slice(0, 10), locale)}
                  </span>
                </span>
                {l.status === "active" && (
                  <Button small variant="danger" onClick={() => setToRevoke(l)}>
                    {t.revoke}
                    <span className="visually-hidden">: {l.question}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={toRevoke !== null}
        title={t.revoke}
        message={format(t.revokeConfirm, { question: toRevoke?.question ?? "" })}
        confirmLabel={t.revoke}
        onClose={() => setToRevoke(null)}
        onConfirm={async () => {
          if (toRevoke) await api("DELETE", `/vault/capture-links/${toRevoke.id}`);
          await links.reload();
        }}
      />
    </div>
  );
}
