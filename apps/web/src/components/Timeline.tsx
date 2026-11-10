"use client";

import type { ReactNode } from "react";
import { decadeOf, type TimelineEvent } from "@inother/shared";
import { format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatPartialDate } from "@/lib/dates";

/** Chronological list of life events, grouped by decade. `actions` renders per-event controls. */
export function Timeline({
  events,
  storyTitles,
  actions,
}: {
  events: TimelineEvent[];
  /** Titles of linked stories the viewer may see (id → title). */
  storyTitles?: Record<string, string>;
  actions?: (event: TimelineEvent) => ReactNode;
}) {
  const { locale, messages } = useI18n();
  const t = messages.timeline;
  const decades = new Map<number, TimelineEvent[]>();
  for (const e of events) decades.set(decadeOf(e.date), [...(decades.get(decadeOf(e.date)) ?? []), e]);

  return (
    <div className="timeline">
      {[...decades.entries()].map(([decade, list]) => (
        <section key={decade} aria-label={format(t.decade, { decade })}>
          <h3 className="timeline-decade">{format(t.decade, { decade })}</h3>
          <ol className="plain timeline-list">
            {list.map((e) => (
              <li key={e.id} className="timeline-item">
                <time className="timeline-date" dateTime={e.date}>
                  {formatPartialDate(e.date, locale)}
                </time>
                <div className="timeline-body">
                  <strong>{e.title}</strong>
                  {e.description && <p className="book-text">{e.description}</p>}
                  {e.storyId && storyTitles?.[e.storyId] && (
                    <p className="small muted">
                      {t.linkedStory}: {storyTitles[e.storyId]}
                    </p>
                  )}
                  {actions && <div className="row no-print">{actions(e)}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
