"use client";

import { useEffect, useState } from "react";
import type { LifeEvent, MediaKind } from "@inother/shared";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Alert, Button, EmptyState, Loading } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError, fetchBlob } from "@/lib/api";
import { formatDualDate } from "@/lib/dates";
import { useApi } from "@/lib/use-api";

interface Inbox {
  paused: boolean;
  heldCount: number;
  delivered: { id: string; messageId: string; title: string; occurrenceOn: string; opened: boolean; hasMedia: boolean; canStop: boolean }[];
  openWhen: { messageId: string; event: LifeEvent; label: string | null }[];
  upcomingCount: number;
}
interface Letter {
  id: string;
  title: string;
  body: string;
  occurrenceOn: string;
  media: { id: string; kind: MediaKind; contentType: string } | null;
}

/** Letters the legator scheduled for this beneficiary: delivered, "open when…", pause/resume. */
export function LettersInbox({ vaultId }: { vaultId: string }) {
  const { locale, messages } = useI18n();
  const t = messages.letters;
  const base = `/inheritances/${vaultId}/messages`;
  const inbox = useApi<Inbox>(base);
  const [reading, setReading] = useState<Letter | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [toOpen, setToOpen] = useState<Inbox["openWhen"][number] | null>(null);
  const [toStop, setToStop] = useState<Inbox["delivered"][number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);

  const fail = (err: unknown) => setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
  const read = async (deliveryId: string) => {
    setError(null);
    try {
      const letter = await api<Letter>("GET", `${base}/${deliveryId}`);
      setMediaUrl(letter.media ? URL.createObjectURL(await fetchBlob(`/inheritances/${vaultId}/media/${letter.media.id}/content`)) : null);
      setReading(letter);
      await inbox.reload();
    } catch (err) {
      fail(err);
    }
  };
  const eventName = (o: Inbox["openWhen"][number]) => o.label ?? t.events[o.event];

  if (inbox.loading && !inbox.data) return <Loading />;
  if (inbox.error) return <Alert kind="error">{errorMessage(messages, inbox.error.code)}</Alert>;
  const d = inbox.data;
  if (!d) return null;

  return (
    <section className="stack" aria-labelledby="letters-h">
      <h2 id="letters-h">{t.inboxTitle}</h2>
      {error && <Alert kind="error">{error}</Alert>}
      {d.paused && (
        <Alert kind="info">
          {t.pausedNote} {d.heldCount > 0 && format(t.heldNote, { count: d.heldCount })}
        </Alert>
      )}
      {d.delivered.length === 0 ? (
        <EmptyState>{t.inboxEmpty}</EmptyState>
      ) : (
        <ul className="plain stack">
          {d.delivered.map((l) => (
            <li key={l.id} className="card row spread">
              <span className="stack" style={{ gap: "0.2rem" }}>
                <strong>
                  {l.title} {!l.opened && <span className="badge ok">{t.unread}</span>}
                </strong>
                <span className="muted small">
                  {format(t.arrivedOn, { date: formatDualDate(l.occurrenceOn, locale) })}
                  {l.hasMedia ? ` · ${t.attachedMedia}` : ""}
                </span>
              </span>
              <span className="row">
                <Button small onClick={() => void read(l.id)}>
                  {t.read}
                  <span className="visually-hidden">: {l.title}</span>
                </Button>
                {l.canStop && (
                  <Button small variant="secondary" onClick={() => setToStop(l)}>
                    {t.stop}
                    <span className="visually-hidden">: {l.title}</span>
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.upcomingCount > 0 && <p className="muted">{format(t.upcoming, { count: d.upcomingCount })}</p>}

      {d.openWhen.length > 0 && (
        <section className="card stack" aria-labelledby="open-when-h">
          <h3 id="open-when-h">{t.openWhenTitle}</h3>
          <p className="muted">{t.openWhenHelp}</p>
          <ul className="plain">
            {d.openWhen.map((o) => (
              <li key={o.messageId} className="row spread">
                <span>✉️ {eventName(o)}</span>
                <Button small variant="secondary" onClick={() => setToOpen(o)}>
                  {t.openNow}
                  <span className="visually-hidden">: {eventName(o)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <Button
          small
          variant="secondary"
          onClick={async () => {
            try {
              await api("PUT", `${base}/pause`, { paused: !d.paused });
              await inbox.reload();
            } catch (err) {
              fail(err);
            }
          }}
        >
          {d.paused ? t.resume : t.pause}
        </Button>
      </div>

      <Dialog open={reading !== null} title={reading?.title ?? ""} onClose={() => setReading(null)}>
        {reading && (
          <div className="stack">
            <p className="muted small">{formatDualDate(reading.occurrenceOn, locale)}</p>
            <p style={{ whiteSpace: "pre-wrap" }}>{reading.body}</p>
            {reading.media && mediaUrl && reading.media.kind === "audio" && <audio controls src={mediaUrl} aria-label={t.attachedMedia} />}
            {reading.media && mediaUrl && reading.media.kind === "video" && <video controls src={mediaUrl} style={{ maxInlineSize: "100%" }} aria-label={t.attachedMedia} />}
            {reading.media && mediaUrl && reading.media.kind === "image" && <img src={mediaUrl} alt={t.attachedMedia} style={{ maxInlineSize: "100%" }} />}
            <div className="row">
              <Button onClick={() => setReading(null)}>{messages.common.close}</Button>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={toOpen !== null}
        title={t.openWhenTitle}
        message={format(t.openConfirm, { event: toOpen ? eventName(toOpen) : "" })}
        confirmLabel={t.openNow}
        onClose={() => setToOpen(null)}
        onConfirm={async () => {
          if (!toOpen) return;
          const { deliveryId } = await api<{ deliveryId: string }>("POST", `${base}/${toOpen.messageId}/open`);
          await inbox.reload();
          await read(deliveryId);
        }}
      />
      <ConfirmDialog
        open={toStop !== null}
        title={t.stop}
        message={format(t.stopConfirm, { title: toStop?.title ?? "" })}
        confirmLabel={t.stop}
        onClose={() => setToStop(null)}
        onConfirm={async () => {
          if (toStop) await api("POST", `${base}/${toStop.messageId}/stop`);
          await inbox.reload();
        }}
      />
    </section>
  );
}
