"use client";

import { useMemo, useState, type FormEvent } from "react";
import { triggerNeedsBirthDate, upcomingOccurrences, type MessageTrigger } from "@inother/shared";
import { ConfirmDialog } from "@/components/Dialog";
import { TriggerEditor, draftFromTrigger, emptyTrigger, triggerFromDraft, useDescribeTrigger, type TriggerDraft } from "@/components/TriggerEditor";
import { Alert, Button, Checkbox, EmptyState, Loading, SelectField, TextArea, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { formatDualDate } from "@/lib/dates";
import type { MediaItem, Person } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

interface LetterMeta {
  id: string;
  title: string;
  trigger: MessageTrigger;
  beneficiaryIds: string[];
  mediaId: string | null;
}
interface Letter extends LetterMeta {
  body: string;
}

const blank = { id: null as string | null, title: "", body: "", beneficiaryIds: [] as string[], mediaId: "", trigger: emptyTrigger as TriggerDraft };

export default function LettersPage() {
  const { locale, messages } = useI18n();
  const t = messages.letters;
  useDocumentTitle(t.title);
  const letters = useApi<{ items: LetterMeta[] }>("/vault/messages");
  const people = useApi<{ items: Person[] }>("/vault/beneficiaries");
  const media = useApi<{ items: MediaItem[] }>("/vault/media");
  const describe = useDescribeTrigger();
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LetterMeta | null>(null);

  const beneficiaries = people.data?.items ?? [];
  const cleanMedia = (media.data?.items ?? []).filter((m) => m.status === "clean");
  const nameOf = (id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "—";

  const trigger = form ? triggerFromDraft(form.trigger) : null;
  const missingBirth = !!form && !!trigger && triggerNeedsBirthDate(trigger) && form.beneficiaryIds.some((id) => !beneficiaries.find((b) => b.id === id)?.birthDate);

  // "If the vault opened today": same engine as the server, run in the browser.
  const preview = useMemo(() => {
    if (!form || !trigger) return [];
    const today = new Date().toISOString().slice(0, 10);
    return form.beneficiaryIds.map((id) => {
      const b = beneficiaries.find((x) => x.id === id);
      let dates: string[] = [];
      try {
        dates = upcomingOccurrences(trigger, { birthDate: b?.birthDate ?? null, bornAfterSunset: b?.bornAfterSunset ?? false, deathDate: today, releaseDate: today }, 3);
      } catch {
        dates = [];
      }
      return { id, name: b?.name ?? "—", dates, needsBirth: triggerNeedsBirthDate(trigger) && !b?.birthDate };
    });
  }, [form, trigger, beneficiaries]);

  const edit = async (id: string) => {
    setError(null);
    setNotice(null);
    const l = await api<Letter>("GET", `/vault/messages/${id}`);
    setForm({ id: l.id, title: l.title, body: l.body, beneficiaryIds: l.beneficiaryIds, mediaId: l.mediaId ?? "", trigger: draftFromTrigger(l.trigger) });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !trigger) return;
    if (!form.title.trim() || !form.body.trim() || form.beneficiaryIds.length === 0 || (trigger.kind === "date" && !trigger.date)) {
      setError(messages.errors.validation_failed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { title: form.title, body: form.body, beneficiaryIds: form.beneficiaryIds, mediaId: form.mediaId || null, trigger };
      await api(form.id ? "PUT" : "POST", form.id ? `/vault/messages/${form.id}` : "/vault/messages", body);
      setForm(null);
      setNotice(t.saved);
      await letters.reload();
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  if (form) {
    return (
      <div className="stack">
        <h1>{form.id ? t.edit : t.new}</h1>
        <form className="stack card" onSubmit={save} noValidate aria-label={form.id ? t.edit : t.new}>
          <TextField label={t.titleLabel} required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <TextArea label={t.bodyLabel} required rows={10} maxLength={50_000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <fieldset className="stack">
            <legend>{t.recipients}</legend>
            <span className="hint">{t.recipientsHelp}</span>
            {beneficiaries.length === 0 && <Alert kind="info">{t.noBeneficiaries}</Alert>}
            {beneficiaries.map((b) => (
              <Checkbox
                key={b.id}
                label={`${b.name} · ${messages.people.relations[b.relation]}`}
                checked={form.beneficiaryIds.includes(b.id)}
                onChange={(e) =>
                  setForm({ ...form, beneficiaryIds: e.target.checked ? [...form.beneficiaryIds, b.id] : form.beneficiaryIds.filter((x) => x !== b.id) })
                }
              />
            ))}
          </fieldset>
          <TriggerEditor value={form.trigger} onChange={(trigger) => setForm({ ...form, trigger })} />
          {missingBirth && <Alert kind="warning">{t.needsBirthDate}</Alert>}
          <SelectField label={t.attachment} hint={t.attachmentNote} value={form.mediaId} onChange={(e) => setForm({ ...form, mediaId: e.target.value })}>
            <option value="">{t.noAttachment}</option>
            {cleanMedia.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ?? messages.media.kinds[m.kind]}
              </option>
            ))}
          </SelectField>

          {preview.length > 0 && (
            <section className="card stack" aria-labelledby="preview-h" aria-live="polite">
              <h2 id="preview-h" style={{ fontSize: "1.05rem" }}>
                {t.preview}
              </h2>
              <ul className="plain">
                {preview.map((p) => (
                  <li key={p.id}>
                    <strong>{p.name}:</strong>{" "}
                    {p.needsBirth ? (
                      <span className="muted">{t.previewNone}</span>
                    ) : trigger?.kind === "life_event" ? (
                      <span className="muted">{t.previewManual}</span>
                    ) : (
                      <span>{p.dates.map((d) => formatDualDate(d, locale)).join(" ; ")}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="muted small">{t.sunsetNote}</p>
            </section>
          )}

          {error && <Alert kind="error">{error}</Alert>}
          <div className="row">
            <Button type="submit" busy={busy}>
              {messages.common.save}
            </Button>
            <Button variant="secondary" onClick={() => setForm(null)}>
              {t.toList}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      {notice && <Alert kind="success">{notice}</Alert>}
      <div>
        <Button
          onClick={() => {
            setNotice(null);
            setError(null);
            setForm({ ...blank, trigger: { ...emptyTrigger } });
          }}
        >
          {t.new}
        </Button>
      </div>
      {letters.loading && <Loading />}
      {letters.error && <Alert kind="error">{errorMessage(messages, letters.error.code)}</Alert>}
      {letters.data && letters.data.items.length === 0 && <EmptyState>{t.empty}</EmptyState>}
      {letters.data && letters.data.items.length > 0 && (
        <ul className="plain stack">
          {letters.data.items.map((l) => (
            <li key={l.id} className="card row spread">
              <span style={{ display: "grid", gap: "0.3rem" }}>
                <strong>{l.title}</strong>
                <span className="muted small">{describe(l.trigger)}</span>
                <span className="small">
                  {t.recipients}: {l.beneficiaryIds.map(nameOf).join(", ")}
                  {l.mediaId ? ` · ${t.attachedMedia}` : ""}
                </span>
              </span>
              <span className="row">
                <Button small variant="secondary" onClick={() => void edit(l.id)}>
                  {messages.common.edit}
                  <span className="visually-hidden">: {l.title}</span>
                </Button>
                <Button small variant="danger" onClick={() => setToDelete(l)}>
                  {messages.common.delete}
                  <span className="visually-hidden">: {l.title}</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title={messages.common.delete}
        message={format(t.deleteConfirm, { title: toDelete?.title ?? "" })}
        confirmLabel={messages.common.delete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await api("DELETE", `/vault/messages/${toDelete.id}`);
          await letters.reload();
        }}
      />
    </div>
  );
}
