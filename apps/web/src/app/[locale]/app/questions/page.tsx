"use client";

import { useId, useMemo, useState } from "react";
import { Alert, Button, Loading } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import type { Answer, CatalogTopic } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

function QuestionItem({ id, text, sensitive, initial }: { id: string; text: string; sensitive: boolean; initial: string }) {
  const { messages } = useI18n();
  const t = messages.questions;
  const fieldId = useId();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim() !== saved.trim();

  const save = async () => {
    setStatus("saving");
    setError(null);
    try {
      if (value.trim() === "") {
        if (saved) await api("DELETE", `/vault/answers/${id}`);
      } else {
        await api("PUT", `/vault/answers/${id}`, { text: value });
      }
      setSaved(value);
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    }
  };

  return (
    <li className="card stack">
      <label htmlFor={fieldId} style={{ fontWeight: 600 }}>
        {text}
      </label>
      {sensitive && <p className="hint">{t.sensitive}</p>}
      <textarea id={fieldId} value={value} onChange={(e) => { setValue(e.target.value); setStatus("idle"); }} maxLength={20000} />
      <div className="row">
        <Button small onClick={save} busy={status === "saving"} disabled={!dirty}>
          {messages.common.save}
        </Button>
        <span role="status" className="small muted">
          {status === "saved" ? messages.common.saved : saved ? t.answered : t.unanswered}
        </span>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
    </li>
  );
}

export default function QuestionsPage() {
  const { messages } = useI18n();
  const t = messages.questions;
  useDocumentTitle(t.title);
  const catalog = useApi<{ topics: CatalogTopic[] }>("/questions");
  const answers = useApi<{ items: Answer[] }>("/vault/answers");

  const answerMap = useMemo(() => new Map((answers.data?.items ?? []).map((a) => [a.questionId, a.text])), [answers.data]);

  if (catalog.loading || answers.loading) return <Loading />;
  if (catalog.error || answers.error) return <Alert kind="error">{errorMessage(messages, (catalog.error ?? answers.error)?.code)}</Alert>;

  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      {catalog.data?.topics.map((topic) => {
        const answered = topic.questions.filter((q) => answerMap.has(q.id)).length;
        return (
          <details key={topic.id} className="card">
            <summary>
              <h2 style={{ display: "inline", fontSize: "1.15rem" }}>{topic.title}</h2>{" "}
              <span className="badge">{format(t.topicProgress, { answered, total: topic.questions.length })}</span>
            </summary>
            <ul className="plain" style={{ marginBlockStart: "1rem" }}>
              {topic.questions.map((q) => (
                <QuestionItem key={q.id} id={q.id} text={q.text} sensitive={q.sensitive} initial={answerMap.get(q.id) ?? ""} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
