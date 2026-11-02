"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ALLOWED_CONTENT_TYPES, CAPTURE_AUDIO_MAX_BYTES } from "@inother/shared";
import { Alert, Button, Loading, TextArea } from "@/components/ui";
import { VoiceRecorder, baseType } from "@/components/VoiceRecorder";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError, uploadWithProgress } from "@/lib/api";
import { readHashToken } from "@/lib/hash-token";
import { useDocumentTitle } from "@/lib/use-title";

const KEY = "inother.capture-token";

/**
 * Public, password-free answer page for ONE question. Large text and controls, one action at a
 * time. The token comes from the URL fragment, is removed from the address bar, and is kept only
 * in this tab's sessionStorage (so a refresh still works).
 */
export default function CapturePage() {
  const { messages } = useI18n();
  const t = messages.capture;
  useDocumentTitle(t.pageTitle);
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<{ question: string; name: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "done">("loading");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = (fromHashOnly: boolean) => {
      let tok = readHashToken();
      if (fromHashOnly && !tok) return;
      try {
        if (tok) sessionStorage.setItem(KEY, tok);
        else tok = sessionStorage.getItem(KEY);
      } catch {
        /* storage unavailable: the fragment token still works for this load */
      }
      setToken(tok);
      setSession(null);
      setText("");
      setError(null);
      if (!tok) {
        setState("invalid");
        return;
      }
      setState("loading");
      api<{ question: string; name: string }>("POST", "/capture/session", { token: tok })
        .then((s) => {
          setSession(s);
          setState("ready");
        })
        .catch(() => setState("invalid"));
    };
    load(false);
    // Opening another capture link in the same tab only changes the fragment (no page load).
    const onHash = () => load(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const finish = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setState("done");
  };

  const sendText = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !text.trim()) {
      setError(messages.errors.validation_failed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/capture/answer", { token, text });
      finish();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "invalid_or_expired_token") setState("invalid");
      else setError(errorMessage(messages, code));
    } finally {
      setBusy(false);
    }
  };

  const sendVoice = async (blob: Blob, onProgress: (p: number) => void): Promise<string | null> => {
    if (!token) return "invalid_or_expired_token";
    const type = baseType(blob.type);
    if (!ALLOWED_CONTENT_TYPES.audio.includes(type)) return "content_type_not_allowed";
    if (blob.size > CAPTURE_AUDIO_MAX_BYTES) return "file_too_large";
    try {
      await uploadWithProgress("/capture/audio", blob, type, onProgress, { "X-Capture-Token": token });
      finish();
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.code : "generic";
    }
  };

  return (
    <div className="container section narrow capture-page">
      <div className="card stack">
        <h1>{t.pageTitle}</h1>
        {state === "loading" && <Loading />}
        {state === "invalid" && <Alert kind="info">{t.invalid}</Alert>}
        {state === "done" && (
          <div role="status" className="stack">
            <p className="capture-thanks">✓ {t.thanks}</p>
            <p>{t.thanksMore}</p>
          </div>
        )}
        {state === "ready" && session && (
          <>
            <p>{format(t.greeting, { name: session.name })}</p>
            <p>{t.intro2}</p>
            <blockquote className="capture-question">{session.question}</blockquote>
            <section className="stack" aria-labelledby="voice-h">
              <h2 id="voice-h">{t.answerByVoice}</h2>
              <VoiceRecorder large saveLabel={t.sendVoice} onSave={sendVoice} />
            </section>
            <form className="stack" onSubmit={sendText} noValidate aria-labelledby="text-h">
              <h2 id="text-h">{t.answerByText}</h2>
              <TextArea label={t.textLabel} rows={8} maxLength={20_000} value={text} onChange={(e) => setText(e.target.value)} />
              {error && <Alert kind="error">{error}</Alert>}
              <div>
                <Button type="submit" className="btn-xl" busy={busy}>
                  {t.send}
                </Button>
              </div>
            </form>
            <p className="muted small">{t.privacyNote}</p>
          </>
        )}
      </div>
    </div>
  );
}
