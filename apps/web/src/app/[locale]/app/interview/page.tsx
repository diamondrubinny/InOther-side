"use client";

import { useId, useState, type FormEvent } from "react";
import { QUESTION_TOPICS } from "@inother/shared";
import { ConfirmDialog } from "@/components/Dialog";
import { Alert, Button, EmptyState, Loading, SelectField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

interface Entry { id: string; question: string; answer: string; createdAt: string }

export default function InterviewPage() {
  const { locale, messages } = useI18n();
  const t = messages.interview;
  useDocumentTitle(t.title);
  const entries = useApi<{ items: Entry[] }>("/interview/entries");
  const [topicId, setTopicId] = useState<string>("");
  const [sitting, setSitting] = useState<{ id: string; question: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Entry | null>(null);
  const answerId = useId();
  const fail = (err: unknown) => setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ sittingId: string; question: string }>("POST", "/interview/start", { topicId: topicId || null });
      setSitting({ id: res.sittingId, question: res.question });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!sitting || !answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ next: string; support: string | null }>("POST", "/interview/answer", {
        sittingId: sitting.id,
        topicId: topicId || null,
        question: sitting.question,
        answer,
      });
      setSupport(res.support);
      setSitting({ id: sitting.id, question: res.next });
      setAnswer("");
      await entries.reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {support && <Alert kind="warning">{support}</Alert>}

      {!sitting ? (
        <section className="card stack" aria-label={t.start}>
          <SelectField label={t.chooseTopic} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">{t.anyTopic}</option>
            {QUESTION_TOPICS.map((tp) => <option key={tp.id} value={tp.id}>{tp.title[locale]}</option>)}
          </SelectField>
          <div><Button busy={busy} onClick={() => void start()}>{t.start}</Button></div>
        </section>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <p className="muted small" style={{ margin: 0 }}>{t.asks}</p>
          {/* Announced to screen readers whenever a new question arrives. */}
          <p aria-live="polite" style={{ fontSize: "1.3rem", fontWeight: 600, margin: 0 }}>{sitting.question}</p>
          <label htmlFor={answerId} className="visually-hidden">{t.answer}</label>
          <textarea id={answerId} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t.answer} rows={6} maxLength={20000} />
          <div className="row">
            <Button type="submit" busy={busy} disabled={!answer.trim()}>{t.saveNext}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void start()}>{t.skip}</Button>
            <Button variant="link" onClick={() => { setSitting(null); setAnswer(""); }}>{t.finish}</Button>
          </div>
        </form>
      )}

      <section className="stack" aria-labelledby="iv-saved">
        <h2 id="iv-saved">{t.saved}</h2>
        {entries.loading && <Loading />}
        {entries.data && entries.data.items.length === 0 && <EmptyState>{t.none}</EmptyState>}
        {entries.data && entries.data.items.length > 0 && (
          <ul className="plain">
            {[...entries.data.items].reverse().map((e) => (
              <li key={e.id} className="card stack">
                <strong>{e.question}</strong>
                <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{e.answer}</p>
                <div><Button small variant="danger" onClick={() => setToDelete(e)}>{t.delete}<span className="visually-hidden">: {e.question}</span></Button></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={toDelete !== null}
        title={t.delete}
        message={toDelete?.question ?? ""}
        confirmLabel={t.delete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await api("DELETE", `/interview/entries/${toDelete.id}`);
          await entries.reload();
        }}
      />
    </div>
  );
}
