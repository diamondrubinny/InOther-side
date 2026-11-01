"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AvatarCanvas } from "@/components/AvatarCanvas";
import { Alert, Button, Loading } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError, fetchBlob } from "@/lib/api";
import { postSse } from "@/lib/sse";
import { SpeechPlayer } from "@/lib/speech-player";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

interface Overview {
  legatorName: string;
  mode: "preview" | "beneficiary";
  available: boolean;
  minor?: boolean;
  portrait: { mouthX: number; mouthY: number; eyeY: number; eyeSpread: number } | null;
  hasMemory: boolean;
  voice: "cloned" | "standard" | "none";
  limits: { sessions: number; minutes: number };
  journey: { sessionsUsed: number; farewellDone: boolean; complete: boolean };
}

type PersonaEvent =
  | { type: "text"; delta: string }
  | { type: "segment"; id: string; text: string }
  | { type: "play_story"; storyId: string; title: string; mediaId: string | null; text: string | null }
  | { type: "play_media"; mediaId: string; title: string }
  | { type: "safety"; level: "crisis"; message: string }
  | { type: "limit"; reason: string }
  | { type: "error"; code: string }
  | { type: "done" };

interface Line { who: "me" | "persona" | "system"; text: string }

// Minimal typing for the (prefixed) Web Speech API.
interface Recognition { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null }

const UUID = /^[0-9a-f-]{36}$/i;

export default function PersonaCallPage() {
  const { locale, messages } = useI18n();
  const t = messages.persona;
  const { vaultId } = useParams<{ vaultId: string }>();
  const valid = UUID.test(vaultId);
  const overview = useApi<Overview>(valid ? `/persona/vaults/${vaultId}` : null);
  const name = overview.data?.legatorName ?? "";
  useDocumentTitle(format(t.callTitle, { name }));

  const [session, setSession] = useState<{ id: string; kind: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [correction, setCorrection] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const player = useRef<SpeechPlayer | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const level = useCallback(() => player.current?.level() ?? 0, []);

  // Portrait is fetched with credentials into a temporary object URL.
  useEffect(() => {
    if (!overview.data?.portrait) return;
    let url: string | null = null;
    fetchBlob(`/persona/vaults/${vaultId}/portrait`)
      .then((b) => setPortraitUrl((url = URL.createObjectURL(b))))
      .catch(() => setPortraitUrl(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [overview.data?.portrait, vaultId]);

  useEffect(() => () => player.current?.stop(), []);
  // Braces matter: in current browsers scrollIntoView() returns a Promise, which React would
  // otherwise treat as the effect's cleanup function and crash.
  useEffect(() => {
    void transcriptEnd.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  const start = async (kind: "regular" | "farewell") => {
    setError(null);
    player.current = new SpeechPlayer();
    player.current.unlock(); // inside the click handler (autoplay policy)
    try {
      const res = await api<{ sessionId: string; kind: string }>("POST", `/persona/vaults/${vaultId}/sessions`, { kind, remember });
      setSession({ id: res.sessionId, kind: res.kind });
      setLines([{ who: "system", text: format(t.disclosure, { name }) }]);
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    }
  };

  const end = async () => {
    recognition.current?.stop();
    player.current?.stop();
    if (session) await api("POST", `/persona/sessions/${session.id}/end`).catch(() => {});
    setSession(null);
    await overview.reload();
  };

  const send = async (text: string) => {
    if (!session || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setLines((l) => [...l, { who: "me", text }, { who: "persona", text: "" }]);
    const appendToReply = (s: string) =>
      setLines((l) => {
        const copy = [...l];
        const last = copy[copy.length - 1];
        if (last?.who === "persona") copy[copy.length - 1] = { ...last, text: last.text + s };
        return copy;
      });
    try {
      await postSse<PersonaEvent>(`/persona/sessions/${session.id}/messages`, { text }, (e) => {
        if (e.type === "text") appendToReply(e.delta);
        else if (e.type === "segment" && overview.data?.voice !== "none") {
          player.current?.enqueue(() => fetchBlob(`/persona/sessions/${session.id}/segments/${e.id}/audio`));
        } else if (e.type === "play_story") {
          setLines((l) => [...l, { who: "system", text: format(t.originalRecording, { title: e.title }) + (e.text ? `\n\n${e.text}` : "") }]);
          if (e.mediaId) {
            const path = overview.data?.mode === "preview" ? `/vault/media/${e.mediaId}/content` : `/inheritances/${vaultId}/media/${e.mediaId}/content`;
            player.current?.enqueue(() => fetchBlob(path));
          }
        } else if (e.type === "play_media") {
          // "Archive mode": the original recording in the legator's real voice.
          setLines((l) => [...l, { who: "system", text: format(t.originalRecording, { title: e.title || messages.media.kinds.audio }) }]);
          const path = overview.data?.mode === "preview" ? `/vault/media/${e.mediaId}/content` : `/inheritances/${vaultId}/media/${e.mediaId}/content`;
          player.current?.enqueue(() => fetchBlob(path));
        } else if (e.type === "safety") {
          setLines((l) => [...l.filter((x) => !(x.who === "persona" && x.text === "")), { who: "system", text: e.message }]);
          setShowHelp(true);
        } else if (e.type === "limit") {
          setLines((l) => [...l, { who: "system", text: t.timeLimit }]);
          setSession(null);
        } else if (e.type === "error") {
          setError(errorMessage(messages, e.code));
        }
      });
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (listening) return recognition.current?.stop();
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = { he: "he-IL", en: "en-US", ar: "ar", ru: "ru-RU", fr: "fr-FR", es: "es-ES" }[locale];
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      if (text) void send(text);
    };
    rec.onend = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    rec.start();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  if (!valid) return <Alert kind="error">{messages.notFound.title}</Alert>;
  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error || !overview.data)
    return <Alert kind="error">{overview.error?.status === 404 ? messages.notFound.title : errorMessage(messages, overview.error?.code)}</Alert>;
  const o = overview.data;
  const micSupported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2);

  return (
    <div className="stack">
      <h1>{format(t.callTitle, { name })}</h1>
      <p className="muted">{format(t.disclosure, { name })}</p>
      {error && <Alert kind="error">{error}</Alert>}

      {!o.available && <Alert kind="info">{o.minor ? t.minorBlocked : t.unavailable}</Alert>}

      {o.available && !session && (
        <section className="card stack" aria-label={t.startCall}>
          {o.mode === "beneficiary" && (
            <p className="badge">{format(t.journeyInfo, { used: o.journey.sessionsUsed, limit: o.limits.sessions })}</p>
          )}
          {o.journey.complete ? (
            <Alert kind="info">{t.journeyComplete}</Alert>
          ) : (
            <>
              <div className="row">
                <Button onClick={() => void start("regular")}>{t.startCall}</Button>
                {o.mode === "beneficiary" && o.journey.sessionsUsed > 0 && (
                  <Button variant="secondary" onClick={() => void start("farewell")}>{t.startFarewell}</Button>
                )}
              </div>
              {o.mode === "beneficiary" && <p className="hint">{t.farewellHelp}</p>}
              <div className="check">
                <input type="checkbox" id="remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <label htmlFor="remember">{t.remember}</label>
              </div>
              <p className="hint">{t.rememberHelp}</p>
              {o.hasMemory && (
                <div>
                  <Button small variant="secondary" onClick={async () => { await api("DELETE", `/persona/vaults/${vaultId}/memory`); setNotice(t.forgotten); await overview.reload(); }}>
                    {t.forget}
                  </Button>
                </div>
              )}
              {notice && <Alert kind="success">{notice}</Alert>}
            </>
          )}
          <p className="small">
            <Link href={`/${locale}/app/inheritances${o.mode === "beneficiary" ? `/${vaultId}` : ""}`}>{messages.common.back}</Link>
          </p>
        </section>
      )}

      {session && (
        <div className="call">
          <div className="avatar-wrap">
            <AvatarCanvas
              imageUrl={portraitUrl}
              mouth={o.portrait ? { x: o.portrait.mouthX, y: o.portrait.mouthY } : null}
              eyes={o.portrait ? { y: o.portrait.eyeY, spread: o.portrait.eyeSpread } : null}
              level={level}
              label={format(t.portraitAlt, { name })}
              initials={initials}
            />
            <span className="ai-badge" aria-hidden="true">{t.aiLabel}</span>
          </div>
          <div className="card stack">
            <div className="transcript" role="log" aria-live="polite" aria-label={format(t.callTitle, { name })}>
              {lines.map((l, i) => (
                <div key={i} className={`bubble ${l.who}`}>
                  <span className="visually-hidden">{l.who === "me" ? `${t.you}: ` : l.who === "persona" ? `${name}: ` : ""}</span>
                  {l.text || (l.who === "persona" && busy ? t.thinking : "")}
                  {/* Proximity test: the legator corrects their own persona. */}
                  {o.mode === "preview" && l.who === "persona" && l.text && !(busy && i === lines.length - 1) && (
                    <div className="row" style={{ marginBlockStart: "0.4rem" }}>
                      <Button small variant="link" onClick={async () => { await api("POST", "/persona/feedback", { reply: l.text, verdict: "like_me" }); setNotice(messages.common.saved); }}>{t.likeMe}</Button>
                      <Button small variant="link" onClick={() => { setCorrecting(i); setCorrection(""); }}>{t.notLikeMe}</Button>
                    </div>
                  )}
                  {correcting === i && (
                    <form
                      className="stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!correction.trim()) return;
                        await api("POST", "/persona/feedback", { reply: l.text, verdict: "not_like_me", correction });
                        setCorrecting(null);
                        setNotice(t.correctionSaved);
                      }}
                    >
                      <label htmlFor={`corr-${i}`}>{t.correctionLabel}</label>
                      <input id={`corr-${i}`} type="text" value={correction} onChange={(e) => setCorrection(e.target.value)} maxLength={500} />
                      <div><Button small type="submit">{t.sendCorrection}</Button></div>
                    </form>
                  )}
                </div>
              ))}
              <div ref={transcriptEnd} />
            </div>
            <form className="row" onSubmit={onSubmit}>
              <label htmlFor="persona-input" className="visually-hidden">{t.typeMessage}</label>
              <input id="persona-input" type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.typeMessage} maxLength={2000} style={{ flex: 1 }} autoComplete="off" />
              <Button type="submit" busy={busy} disabled={!input.trim()}>{t.send}</Button>
            </form>
            <div className="row">
              {micSupported && (
                <Button variant="secondary" small onClick={toggleMic} aria-pressed={listening}>
                  {listening ? t.micStop : t.micStart}
                </Button>
              )}
              <Button variant="secondary" small aria-pressed={muted} onClick={() => { setMuted(!muted); player.current?.setMuted(!muted); }}>
                {muted ? t.unmute : t.mute}
              </Button>
              <Button variant="secondary" small onClick={() => setShowHelp(true)}>{t.needHelp}</Button>
              <Button variant="danger" small onClick={() => void end()}>{t.endCall}</Button>
            </div>
            {micSupported && <p className="hint">{t.micNotice}</p>}
            {showHelp && <Alert kind="warning">{t.helpText}</Alert>}
            {notice && <Alert kind="success">{notice}</Alert>}
          </div>
        </div>
      )}
    </div>
  );
}
