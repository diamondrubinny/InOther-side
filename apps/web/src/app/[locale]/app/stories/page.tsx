"use client";

import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/Dialog";
import { Alert, Button, EmptyState, Loading } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api";
import type { StoryMeta } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

export default function StoriesPage() {
  const { locale, messages } = useI18n();
  const t = messages.stories;
  useDocumentTitle(t.title);
  const { data, error, loading, reload } = useApi<{ items: StoryMeta[] }>("/vault/stories");
  const [toDelete, setToDelete] = useState<StoryMeta | null>(null);

  const releaseText = (s: StoryMeta) =>
    s.releaseRule === "date"
      ? format(t.releaseSummaryDate, { date: s.releaseAt ? new Date(s.releaseAt).toLocaleDateString(locale) : "" })
      : s.releaseRule === "on_topic"
        ? format(t.releaseSummaryTopic, { topic: s.topic ?? "" })
        : t.releaseSummaryOnRelease;

  return (
    <div className="stack">
      <div className="row spread">
        <h1 style={{ margin: 0 }}>{t.title}</h1>
        <Link className="btn" href={`/${locale}/app/stories/new`}>{t.new}</Link>
      </div>
      <p>{t.intro}</p>
      <p className="muted small">{t.honesty}</p>
      {loading && <Loading />}
      {error && <Alert kind="error">{errorMessage(messages, error.code)}</Alert>}
      {data && data.items.length === 0 && <EmptyState>{t.empty}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="plain">
          {data.items.map((s) => (
            <li key={s.id} className="card row spread">
              <div>
                <h2 style={{ fontSize: "1.1rem", margin: 0 }}>{s.title}</h2>
                <p className="muted small" style={{ margin: 0 }}>
                  {s.audience === "all" ? t.audienceAll : t.audienceSpecific} · {releaseText(s)}
                </p>
              </div>
              <div className="row">
                <Link className="btn small secondary" href={`/${locale}/app/stories/${s.id}`}>
                  {messages.common.edit}<span className="visually-hidden">: {s.title}</span>
                </Link>
                <Button small variant="danger" onClick={() => setToDelete(s)}>
                  {messages.common.delete}<span className="visually-hidden">: {s.title}</span>
                </Button>
              </div>
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
          if (toDelete) await api("DELETE", `/vault/stories/${toDelete.id}`);
          await reload();
        }}
      />
    </div>
  );
}
