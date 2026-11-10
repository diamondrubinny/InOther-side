"use client";

import { useEffect, useMemo, useState } from "react";
import type { TimelineEvent } from "@inother/shared";
import qrcode from "qrcode-generator";
import { Timeline } from "@/components/Timeline";
import { Alert, Button, EmptyState, Loading } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { fetchBlob } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

interface Book {
  vaultId: string;
  legatorName: string;
  openingMessage: string | null;
  timeline: TimelineEvent[];
  chapters: { id: string; title: string; entries: { question: string; answer: string }[] }[];
  interviews: { question: string; answer: string }[];
  stories: { id: string; title: string; body: string }[];
  recordings: { id: string; kind: "audio" | "video"; label: string | null; transcript: string | null }[];
  photos: { id: string; label: string | null }[];
}

const MAX_PHOTOS = 40;

/** QR as inline SVG, generated in the browser. It encodes only a URL to this site (no content, no token). */
function Qr({ url, label }: { url: string; label: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { size: n + 8, path }; // 4-module quiet zone (QR spec)
  }, [url]);
  return (
    <svg className="book-qr" role="img" aria-label={label} viewBox={`0 0 ${svg.size} ${svg.size}`} shapeRendering="crispEdges">
      <rect width={svg.size} height={svg.size} fill="#fff" />
      <path d={svg.path} fill="#000" />
    </svg>
  );
}

/**
 * The printable legacy book. `mode` decides the data source and where QR codes point:
 * the legator previews everything; a beneficiary gets only what they were given.
 */
export function LegacyBook({ mode, vaultId }: { mode: "legator" | "beneficiary"; vaultId?: string }) {
  const { locale, messages } = useI18n();
  const t = messages.book;
  useDocumentTitle(t.title);
  const base = mode === "legator" ? "/vault" : `/inheritances/${vaultId}`;
  const book = useApi<Book>(`${base}/book?locale=${locale}`);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  // Photos are fetched (authenticated) and shown from memory; nothing is embedded in the page source.
  useEffect(() => {
    const list = book.data?.photos.slice(0, MAX_PHOTOS);
    if (!list) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      for (const p of list) {
        try {
          const url = URL.createObjectURL(await fetchBlob(`${base}/media/${p.id}/content`));
          urls.push(url);
          if (cancelled) return;
          setPhotos((prev) => ({ ...prev, [p.id]: url }));
        } catch {
          /* a photo that fails to load is simply left out */
        }
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [book.data, base]);

  if (book.loading) return <Loading />;
  if (book.error || !book.data) return <Alert kind="error">{book.error?.status === 404 ? messages.notFound.title : errorMessage(messages, book.error?.code)}</Alert>;
  const b = book.data;
  const isEmpty = !b.openingMessage && b.timeline.length + b.chapters.length + b.interviews.length + b.stories.length + b.recordings.length + b.photos.length === 0;
  const recordingUrl = (id: string) =>
    mode === "legator" ? `${window.location.origin}/${locale}/app/media` : `${window.location.origin}/${locale}/app/inheritances/${b.vaultId}?media=${id}`;
  const today = formatDate(new Date().toISOString().slice(0, 10), locale);

  return (
    <div className="stack">
      <div className="stack no-print">
        <h1>{t.title}</h1>
        <p className="muted">{t.intro}</p>
        {mode === "legator" && <Alert kind="info">{t.previewNote}</Alert>}
        <Alert kind="warning">{t.printWarning}</Alert>
        {!isEmpty && (
          <div>
            <Button onClick={() => window.print()}>{t.print}</Button>
          </div>
        )}
        {isEmpty && <EmptyState>{t.empty}</EmptyState>}
      </div>

      {!isEmpty && (
        <article className="book" aria-label={`${t.subtitle}: ${b.legatorName}`}>
          <header className="book-cover">
            <p className="book-cover-sub">{t.subtitle}</p>
            <p className="book-cover-name">{b.legatorName}</p>
            <p className="muted small">{format(t.generatedOn, { date: today })}</p>
          </header>

          {b.openingMessage && (
            <section className="book-chapter">
              <h2>{t.opening}</h2>
              <p className="book-text">{b.openingMessage}</p>
            </section>
          )}

          {b.timeline.length > 0 && (
            <section className="book-chapter">
              <h2>{messages.timeline.heading}</h2>
              <Timeline events={b.timeline} storyTitles={Object.fromEntries(b.stories.map((s) => [s.id, s.title]))} />
            </section>
          )}

          {b.chapters.map((c) => (
            <section key={c.id} className="book-chapter">
              <h2>{c.title}</h2>
              {c.entries.map((e) => (
                <div key={e.question} className="book-entry">
                  <h3>{e.question}</h3>
                  <p className="book-text">{e.answer}</p>
                </div>
              ))}
            </section>
          ))}

          {b.interviews.length > 0 && (
            <section className="book-chapter">
              <h2>{t.interviews}</h2>
              {b.interviews.map((e, i) => (
                <div key={i} className="book-entry">
                  <h3>{e.question}</h3>
                  <p className="book-text">{e.answer}</p>
                </div>
              ))}
            </section>
          )}

          {b.stories.length > 0 && (
            <section className="book-chapter">
              <h2>{t.stories}</h2>
              {b.stories.map((s) => (
                <div key={s.id} className="book-entry">
                  <h3>{s.title}</h3>
                  <p className="book-text">{s.body}</p>
                </div>
              ))}
            </section>
          )}

          {b.recordings.length > 0 && (
            <section className="book-chapter">
              <h2>{t.recordings}</h2>
              {b.recordings.map((r) => (
                <div key={r.id} className="book-entry book-recording">
                  <div>
                    <h3>{r.label ?? t.kinds[r.kind]}</h3>
                    <p className="book-text">{r.transcript ?? <span className="muted">{t.noTranscript}</span>}</p>
                  </div>
                  <figure>
                    <Qr url={recordingUrl(r.id)} label={`${t.scan}: ${r.label ?? t.kinds[r.kind]}`} />
                    <figcaption className="small muted">{t.scan}</figcaption>
                  </figure>
                </div>
              ))}
            </section>
          )}

          {b.photos.length > 0 && (
            <section className="book-chapter">
              <h2>{t.photos}</h2>
              <div className="book-photos">
                {b.photos.slice(0, MAX_PHOTOS).map((p) =>
                  photos[p.id] ? (
                    <figure key={p.id}>
                      <img src={photos[p.id]} alt={p.label ?? t.photos} />
                      {p.label && <figcaption>{p.label}</figcaption>}
                    </figure>
                  ) : null,
                )}
              </div>
            </section>
          )}
        </article>
      )}
    </div>
  );
}
