"use client";

import { useState, type FormEvent } from "react";
import type { TimelineEvent } from "@inother/shared";
import { ConfirmDialog } from "@/components/Dialog";
import { Timeline } from "@/components/Timeline";
import { Alert, Button, EmptyState, Loading, SelectField, TextArea, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { gregorianMonthNames } from "@/lib/dates";
import type { MediaItem, StoryMeta } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

const blank = { id: null as string | null, title: "", year: "", month: "", day: "", description: "", storyId: "", mediaId: "" };
const pad = (n: string) => n.padStart(2, "0");

export default function TimelinePage() {
  const { locale, messages } = useI18n();
  const t = messages.timeline;
  useDocumentTitle(t.title);
  const events = useApi<{ items: TimelineEvent[] }>("/vault/timeline");
  const stories = useApi<{ items: StoryMeta[] }>("/vault/stories");
  const media = useApi<{ items: MediaItem[] }>("/vault/media");
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<TimelineEvent | null>(null);

  const storyTitles = Object.fromEntries((stories.data?.items ?? []).map((s) => [s.id, s.title]));
  const cleanMedia = (media.data?.items ?? []).filter((m) => m.status === "clean");

  const edit = (e: TimelineEvent) => {
    const [y, m, d] = e.date.split("-");
    setNotice(null);
    setError(null);
    setForm({ id: e.id, title: e.title, year: y ?? "", month: m ? String(Number(m)) : "", day: d ? String(Number(d)) : "", description: e.description ?? "", storyId: e.storyId ?? "", mediaId: e.mediaId ?? "" });
  };

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    if (!form.title.trim() || !/^\d{4}$/.test(form.year)) {
      setError(messages.errors.validation_failed);
      return;
    }
    const date = form.year + (form.month ? `-${pad(form.month)}` + (form.day ? `-${pad(form.day)}` : "") : "");
    setBusy(true);
    setError(null);
    try {
      const body = { title: form.title, date, description: form.description.trim() || null, storyId: form.storyId || null, mediaId: form.mediaId || null };
      await api(form.id ? "PUT" : "POST", form.id ? `/vault/timeline/${form.id}` : "/vault/timeline", body);
      setForm(null);
      setNotice(t.saved);
      await events.reload();
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      {notice && <Alert kind="success">{notice}</Alert>}

      {form ? (
        <form className="card stack" onSubmit={save} noValidate aria-label={form.id ? t.edit : t.add}>
          <h2>{form.id ? t.edit : t.add}</h2>
          <TextField label={t.eventTitle} required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="grid">
            <TextField label={t.year} hint={t.dateHelp} required type="number" min={1850} max={new Date().getFullYear()} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
            <SelectField label={t.month} value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value, day: e.target.value ? form.day : "" })}>
              <option value="">{t.noMonth}</option>
              {gregorianMonthNames(locale).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>
            {form.month && <TextField label={t.day} type="number" min={1} max={31} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} />}
          </div>
          <TextArea label={t.description} rows={3} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid">
            <SelectField label={t.story} value={form.storyId} onChange={(e) => setForm({ ...form, storyId: e.target.value })}>
              <option value="">{t.none}</option>
              {(stories.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </SelectField>
            <SelectField label={t.media} value={form.mediaId} onChange={(e) => setForm({ ...form, mediaId: e.target.value })}>
              <option value="">{t.none}</option>
              {cleanMedia.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? messages.media.kinds[m.kind]}
                </option>
              ))}
            </SelectField>
          </div>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="row">
            <Button type="submit" busy={busy}>{messages.common.save}</Button>
            <Button variant="secondary" onClick={() => setForm(null)}>{messages.common.cancel}</Button>
          </div>
        </form>
      ) : (
        <div>
          <Button
            onClick={() => {
              setNotice(null);
              setError(null);
              setForm({ ...blank });
            }}
          >
            {t.add}
          </Button>
        </div>
      )}

      {events.loading && <Loading />}
      {events.error && <Alert kind="error">{errorMessage(messages, events.error.code)}</Alert>}
      {events.data && events.data.items.length === 0 && <EmptyState>{t.empty}</EmptyState>}
      {events.data && events.data.items.length > 0 && (
        <section className="card" aria-labelledby="timeline-h">
          <h2 id="timeline-h">{t.heading}</h2>
          <Timeline
            events={events.data.items}
            storyTitles={storyTitles}
            actions={(e) => (
              <>
                <Button small variant="secondary" onClick={() => edit(e)}>
                  {messages.common.edit}
                  <span className="visually-hidden">: {e.title}</span>
                </Button>
                <Button small variant="danger" onClick={() => setToDelete(e)}>
                  {messages.common.delete}
                  <span className="visually-hidden">: {e.title}</span>
                </Button>
              </>
            )}
          />
        </section>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title={messages.common.delete}
        message={format(t.deleteConfirm, { title: toDelete?.title ?? "" })}
        confirmLabel={messages.common.delete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await api("DELETE", `/vault/timeline/${toDelete.id}`);
          await events.reload();
        }}
      />
    </div>
  );
}
