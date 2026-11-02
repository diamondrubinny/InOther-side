"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface MySuggestion {
  id: string;
  text: string;
  status: "pending" | "accepted" | "dismissed" | "answered";
}

/** A family member suggests a question to the living legator. They never see the answer. */
export function SuggestQuestion({ vaultId, legatorName }: { vaultId: string; legatorName: string }) {
  const { messages } = useI18n();
  const t = messages.capture;
  const mine = useApi<{ items: MySuggestion[] }>(`/inheritances/${vaultId}/suggestions`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 3) {
      setStatus({ kind: "error", text: messages.errors.validation_failed });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await api("POST", `/inheritances/${vaultId}/suggestions`, { text });
      setText("");
      setStatus({ kind: "success", text: t.suggestSent });
      await mine.reload();
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(messages, err instanceof ApiError ? err.code : undefined) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="stack" style={{ marginBlockStart: "0.75rem" }}>
      <summary>
        {t.suggestTitle}
        <span className="visually-hidden">: {legatorName}</span>
      </summary>
      <p className="muted">{t.suggestHelp}</p>
      <form className="stack" onSubmit={submit} noValidate aria-label={format("{a}: {b}", { a: t.suggestTitle, b: legatorName })}>
        <TextField label={t.suggestLabel} required maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        {status && <Alert kind={status.kind}>{status.text}</Alert>}
        <div>
          <Button type="submit" busy={busy}>{t.suggestSend}</Button>
        </div>
      </form>
      {mine.data && mine.data.items.length > 0 && (
        <>
          <h3 style={{ fontSize: "1rem" }}>{t.mySuggestions}</h3>
          <ul className="plain">
            {mine.data.items.map((s) => (
              <li key={s.id}>
                „{s.text}” · <span className={`badge ${s.status === "answered" ? "ok" : ""}`}>{t.myStatuses[s.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
