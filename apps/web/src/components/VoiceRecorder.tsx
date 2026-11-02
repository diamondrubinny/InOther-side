"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, ProgressBar } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";

export function baseType(type: string): string {
  return type.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Microphone recorder: record → listen → save or discard. Nothing leaves the browser until "save".
 * `onSave` uploads the blob and returns an error code (or null on success).
 * `large` = extra-large controls for older users (capture page).
 */
export function VoiceRecorder({
  onSave,
  large = false,
  saveLabel,
}: {
  onSave: (blob: Blob, onProgress: (p: number) => void) => Promise<string | null>;
  large?: boolean;
  saveLabel?: string;
}) {
  const { messages } = useI18n();
  const t = messages.media;
  const [state, setState] = useState<"idle" | "recording" | "recorded" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [supported, setSupported] = useState(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported("MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia);
    return () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
    };
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  if (!supported) return <Alert kind="info">{t.recorderUnsupported}</Alert>;

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const recorded = new Blob(chunks, { type: baseType(rec.mimeType || mimeType || "audio/webm") });
        setBlob(recorded);
        setPreviewUrl(URL.createObjectURL(recorded));
        setState("recorded");
      };
      recorder.current = rec;
      rec.start(1000);
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setState("recording");
    } catch {
      setError(t.micDenied);
    }
  };
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stop();
  };
  const discard = () => {
    setBlob(null);
    setPreviewUrl(null);
    setState("idle");
  };
  const save = async () => {
    if (!blob) return;
    setState("saving");
    const code = await onSave(blob, setProgress);
    if (code) {
      setError(errorMessage(messages, code));
      setState("recorded");
    } else discard();
  };

  const size = large ? "btn-xl" : undefined;
  return (
    <div className="stack">
      {error && <Alert kind="error">{error}</Alert>}
      {state === "idle" && (
        <div>
          <Button className={size} onClick={start}>● {t.recordStart}</Button>
        </div>
      )}
      {state === "recording" && (
        <div className="row">
          <span role="status" aria-live="polite">{format(t.recording, { seconds })}</span>
          <Button className={size} variant="danger" onClick={stop}>■ {t.recordStop}</Button>
        </div>
      )}
      {(state === "recorded" || state === "saving") && previewUrl && (
        <>
          <audio controls src={previewUrl} />
          {state === "saving" && <ProgressBar value={progress} label={format(t.uploading, { percent: progress })} />}
          <div className="row">
            <Button className={size} onClick={save} busy={state === "saving"}>{saveLabel ?? t.recordSave}</Button>
            <Button className={size} variant="secondary" onClick={discard} disabled={state === "saving"}>{t.recordDiscard}</Button>
          </div>
        </>
      )}
    </div>
  );
}
