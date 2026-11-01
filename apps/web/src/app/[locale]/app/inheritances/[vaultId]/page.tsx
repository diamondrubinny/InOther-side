"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { LettersInbox } from "@/components/LettersInbox";
import { Alert, Button, EmptyState, Loading } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { fetchBlob } from "@/lib/api";
import type { MediaItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

const UUID = /^[0-9a-f-]{36}$/i;

export default function InheritancePage() {
  const { locale, messages } = useI18n();
  const t = messages.release;
  const { vaultId } = useParams<{ vaultId: string }>();
  const valid = UUID.test(vaultId);
  const base = valid ? `/inheritances/${vaultId}` : null;
  const summary = useApi<{ legatorName: string; openingMessage: string | null }>(base);
  const stories = useApi<{ items: { id: string; title: string; body: string }[] }>(base && `${base}/stories`);
  const answers = useApi<{ items: { questionId: string; question: string | null; text: string }[] }>(base && `${base}/answers`);
  const media = useApi<{ items: MediaItem[] }>(base && `${base}/media`);
  const [viewing, setViewing] = useState<{ item: MediaItem; url: string } | null>(null);
  useDocumentTitle(summary.data?.legatorName ?? t.inheritancesTitle);
  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);

  if (!valid) return <Alert kind="error">{messages.notFound.title}</Alert>;
  if (summary.loading) return <Loading />;
  if (summary.error || !summary.data)
    return <Alert kind="error">{summary.error?.status === 404 ? messages.notFound.title : errorMessage(messages, summary.error?.code)}</Alert>;

  return (
    <div className="stack">
      <h1>{summary.data.legatorName}</h1>
      <p className="muted">{t.griefNote}</p>
      <div><Link className="btn" href={`/${locale}/app/persona/${vaultId}`}>{messages.persona.talk}</Link></div>
      <p className="muted small">{messages.common.aiNotice}</p>
      {summary.data.openingMessage && (
        <section className="card" aria-labelledby="opening">
          <h2 id="opening">{t.openingMessage}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{summary.data.openingMessage}</p>
        </section>
      )}
      <LettersInbox vaultId={vaultId} />
      <section className="stack" aria-labelledby="stories-h">
        <h2 id="stories-h">{t.storiesTitle}</h2>
        {stories.loading ? <Loading /> : stories.data?.items.length ? (
          stories.data.items.map((s) => (
            <article key={s.id} className="card">
              <h3>{s.title}</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{s.body}</p>
            </article>
          ))
        ) : <EmptyState>{t.noContent}</EmptyState>}
      </section>
      <section className="stack" aria-labelledby="media-h">
        <h2 id="media-h">{t.mediaTitle}</h2>
        {media.data?.items.length ? (
          <ul className="plain">
            {media.data.items.map((m) => (
              <li key={m.id} className="card row spread">
                <span>{m.label ?? messages.media.kinds[m.kind]}</span>
                <Button small variant="secondary" onClick={async () => setViewing({ item: m, url: URL.createObjectURL(await fetchBlob(`${base}/media/${m.id}/content`)) })}>
                  {messages.media.open}
                </Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState>{t.noContent}</EmptyState>}
      </section>
      <section className="stack" aria-labelledby="answers-h">
        <h2 id="answers-h">{t.answersTitle}</h2>
        {answers.data?.items.length ? (
          answers.data.items.map((a) => (
            <div key={a.questionId} className="card">
              <h3 style={{ fontSize: "1rem" }}>{a.question}</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{a.text}</p>
            </div>
          ))
        ) : <EmptyState>{t.noContent}</EmptyState>}
      </section>
      <Dialog open={viewing !== null} title={viewing?.item.label ?? messages.media.kinds[viewing?.item.kind ?? "image"]} onClose={() => setViewing(null)}>
        {viewing?.item.kind === "image" && <img src={viewing.url} alt={viewing.item.label ?? messages.media.kinds.image} />}
        {viewing?.item.kind === "audio" && <audio controls src={viewing.url} />}
        {viewing?.item.kind === "video" && <video controls src={viewing.url} style={{ maxInlineSize: "100%" }} />}
        <div className="row" style={{ marginBlockStart: "1rem" }}><Button onClick={() => setViewing(null)}>{messages.common.close}</Button></div>
      </Dialog>
    </div>
  );
}
