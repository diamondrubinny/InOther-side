"use client";

import { useEffect, useState } from "react";
import type { PersonaCard } from "@inother/shared";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Alert, Button, Loading, TextArea, TextField } from "./ui";

interface Profile { status: "none" | "draft" | "approved"; card: PersonaCard | null; version: number }

const lines = (v: string[]) => v.join("\n");
const unlines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

/** The legator reviews, edits and approves the personality card. Only approved cards reach beneficiaries. */
export function PersonaCardEditor() {
  const { messages } = useI18n();
  const t = messages.persona;
  const profile = useApi<Profile>("/persona/profile");
  const [card, setCard] = useState<PersonaCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => { if (profile.data?.card) setCard(profile.data.card); }, [profile.data]);

  const run = async (fn: () => Promise<Profile>, okText?: string) => {
    setBusy(true);
    setFb(null);
    try {
      const p = await fn();
      profile.setData(p);
      if (p.card) setCard(p.card);
      if (okText) setFb({ kind: "success", text: okText });
    } catch (err) {
      setFb({ kind: "error", text: errorMessage(messages, err instanceof ApiError ? err.code : undefined) });
    } finally {
      setBusy(false);
    }
  };

  if (profile.loading) return <Loading />;
  const status = profile.data?.status ?? "none";
  const set = <K extends keyof PersonaCard>(k: K, v: PersonaCard[K]) => card && setCard({ ...card, [k]: v });

  return (
    <section className="card stack" aria-labelledby="card-h">
      <h2 id="card-h">{t.cardTitle}</h2>
      <p className="muted">{t.cardHelp}</p>
      <p><span className={`badge ${status === "approved" ? "ok" : ""}`}>{t.cardStatuses[status]}</span></p>
      {fb && <Alert kind={fb.kind}>{fb.text}</Alert>}
      <div>
        <Button variant="secondary" busy={busy} onClick={() => run(() => api<Profile>("POST", "/persona/profile/generate"))}>
          {status === "none" ? t.generate : t.regenerate}
        </Button>
      </div>
      {card && (
        <>
          <TextField label={t.preferredName} value={card.preferredName} onChange={(e) => set("preferredName", e.target.value)} maxLength={80} />
          <TextArea label={t.traits} hint={t.onePerLine} value={lines(card.traits)} onChange={(e) => set("traits", unlines(e.target.value))} rows={3} />
          <TextArea label={t.values} hint={t.onePerLine} value={lines(card.values)} onChange={(e) => set("values", unlines(e.target.value))} rows={3} />
          <TextArea label={t.humor} value={card.humor} onChange={(e) => set("humor", e.target.value)} rows={2} maxLength={600} />
          <TextArea label={t.speechPatterns} hint={t.onePerLine} value={lines(card.speechPatterns)} onChange={(e) => set("speechPatterns", unlines(e.target.value))} rows={3} />
          <TextArea label={t.emotionalStyle} value={card.emotionalStyle} onChange={(e) => set("emotionalStyle", e.target.value)} rows={3} maxLength={800} />
          {card.relationships.length > 0 && (
            <fieldset>
              <legend>{t.relationships}</legend>
              {card.relationships.map((r, i) => (
                <TextField
                  key={`${r.name}-${i}`}
                  label={`${r.name} · ${t.howIAddress}`}
                  value={r.howIAddressThem}
                  maxLength={120}
                  onChange={(e) => set("relationships", card.relationships.map((x, j) => (j === i ? { ...x, howIAddressThem: e.target.value } : x)))}
                />
              ))}
            </fieldset>
          )}
          <TextArea label={t.topicsToAvoid} hint={t.onePerLine} value={lines(card.topicsToAvoid)} onChange={(e) => set("topicsToAvoid", unlines(e.target.value))} rows={2} />
          <TextArea label={t.corrections} hint={t.onePerLine} value={lines(card.corrections)} onChange={(e) => set("corrections", unlines(e.target.value))} rows={3} />
          <div className="row">
            <Button variant="secondary" busy={busy} onClick={() => run(() => api<Profile>("PUT", "/persona/profile", { card, approve: false }), messages.common.saved)}>{t.saveDraft}</Button>
            <Button busy={busy} onClick={() => run(() => api<Profile>("PUT", "/persona/profile", { card, approve: true }), messages.common.saved)}>{t.approve}</Button>
          </div>
        </>
      )}
    </section>
  );
}
