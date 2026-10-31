"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ALLOWED_CONTENT_TYPES, MAX_MEDIA_BYTES, type MediaKind } from "@inother/shared";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Alert, Button, EmptyState, Loading, ProgressBar, SelectField, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError, fetchBlob, uploadWithProgress } from "@/lib/api";
import type { MediaItem, StoryMeta } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

const PENDING = new Set(["awaiting_upload", "uploading", "quarantined", "scanning"]);

function kindOf(type: string): MediaKind | null {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return null;
}

function baseType(type: string): string {
  return type.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Creates the reservation, then streams the bytes. Returns an error code or null. */
async function uploadBlob(
  blob: Blob,
  extra: { label?: string; storyId?: string },
  onProgress: (p: number) => void,
): Promise<string | null> {
  const contentType = baseType(blob.type);
  const kind = kindOf(contentType);
  if (!kind || !ALLOWED_CONTENT_TYPES[kind].includes(contentType)) return "content_type_not_allowed";
  if (blob.size > MAX_MEDIA_BYTES[kind]) return "file_too_large";
  try {
    const created = await api<MediaItem & { uploadUrl: string }>("POST", "/vault/media", {
      kind,
      contentType,
      sizeBytes: blob.size,
      ...(extra.label ? { label: extra.label } : {}),
      ...(extra.storyId ? { storyId: extra.storyId } : {}),
    });
    await uploadWithProgress(created.uploadUrl, blob, contentType, onProgress);
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.code : "generic";
  }
}

function Recorder({ onSaved }: { onSaved: () => void }) {
  const { messages } = useI18n();
  const t = messages.media;
  const [state, setState] = useState<"idle" | "recording" | "recorded" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
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
    const code = await uploadBlob(blob, {}, setProgress);
    if (code) {
      setError(errorMessage(messages, code));
      setState("recorded");
    } else {
      discard();
      onSaved();
    }
  };

  return (
    <section className="card stack" aria-labelledby="rec-title">
      <h2 id="rec-title">{t.recordTitle}</h2>
      <p className="muted">{t.recordHelp}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {state === "idle" && <div><Button onClick={start}>● {t.recordStart}</Button></div>}
      {state === "recording" && (
        <div className="row">
          <span role="status" aria-live="polite">{format(t.recording, { seconds })}</span>
          <Button variant="danger" onClick={stop}>■ {t.recordStop}</Button>
        </div>
      )}
      {(state === "recorded" || state === "saving") && previewUrl && (
        <>
          <audio controls src={previewUrl} />
          {state === "saving" && <ProgressBar value={progress} label={format(t.uploading, { percent: progress })} />}
          <div className="row">
            <Button onClick={save} busy={state === "saving"}>{t.recordSave}</Button>
            <Button variant="secondary" onClick={discard} disabled={state === "saving"}>{t.recordDiscard}</Button>
          </div>
        </>
      )}
    </section>
  );
}

export default function MediaPage() {
  const { locale, messages } = useI18n();
  const t = messages.media;
  useDocumentTitle(t.title);
  const { data, error, loading, reload } = useApi<{ items: MediaItem[] }>("/vault/media");
  const stories = useApi<{ items: StoryMeta[] }>("/vault/stories");
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [storyId, setStoryId] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ item: MediaItem; url: string } | null>(null);
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Poll while files are still being checked.
  const hasPending = data?.items.some((m) => PENDING.has(m.status)) ?? false;
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => void reload(), 3000);
    return () => clearInterval(id);
  }, [hasPending, reload]);

  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploadError(null);
    setProgress(0);
    const code = await uploadBlob(file, { label: label.trim() || undefined, storyId: storyId || undefined }, setProgress);
    setProgress(null);
    if (code) {
      setUploadError(errorMessage(messages, code));
      return;
    }
    setFile(null);
    setLabel("");
    setStoryId("");
    if (fileInput.current) fileInput.current.value = "";
    await reload();
  };

  const open = async (item: MediaItem) => {
    try {
      const blob = await fetchBlob(`/vault/media/${item.id}/content`);
      setViewing({ item, url: URL.createObjectURL(blob) });
    } catch {
      setUploadError(messages.errors.generic);
    }
  };

  const download = async (item: MediaItem) => {
    const blob = await fetchBlob(`/vault/media/${item.id}/content`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.label ?? item.id}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p>{t.intro}</p>

      <Recorder onSaved={() => void reload()} />

      <form className="card stack" onSubmit={submit} aria-labelledby="upload-title" noValidate>
        <h2 id="upload-title">{t.uploadTitle}</h2>
        <div className="field">
          <label htmlFor="media-file">{t.chooseFile}</label>
          <span id="media-file-hint" className="hint">{t.allowed}</span>
          <input
            ref={fileInput}
            id="media-file"
            type="file"
            aria-describedby="media-file-hint"
            accept={Object.values(ALLOWED_CONTENT_TYPES).flat().join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <TextField label={<>{t.label} <span className="muted">{messages.common.optional}</span></>} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
        <SelectField label={t.attachToStory} value={storyId} onChange={(e) => setStoryId(e.target.value)}>
          <option value="">{t.none}</option>
          {(stories.data?.items ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </SelectField>
        {progress !== null && <ProgressBar value={progress} label={format(t.uploading, { percent: progress })} />}
        {progress !== null && <p role="status" className="small">{format(t.uploading, { percent: progress })}</p>}
        {uploadError && <Alert kind="error">{uploadError}</Alert>}
        <div>
          <Button type="submit" disabled={!file} busy={progress !== null}>{t.upload}</Button>
        </div>
      </form>

      {loading && <Loading />}
      {error && <Alert kind="error">{errorMessage(messages, error.code)}</Alert>}
      {data && data.items.length === 0 && <EmptyState>{t.empty}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="plain" aria-live="polite">
          {data.items.map((m) => (
            <li key={m.id} className="card row spread">
              <div>
                <strong>{m.label ?? t.kinds[m.kind]}</strong>{" "}
                <span className={`badge ${m.status === "clean" ? "ok" : m.status === "infected" || m.status === "rejected" ? "bad" : ""}`}>
                  {t.statuses[m.status]}
                </span>
                <div className="small muted">
                  {t.kinds[m.kind]} · {(m.sizeBytes / 1024 / 1024).toFixed(1)} MB · {new Date(m.createdAt).toLocaleDateString(locale)}
                </div>
              </div>
              <div className="row">
                {m.status === "clean" && (
                  <>
                    <Button small variant="secondary" onClick={() => void open(m)}>{t.open}</Button>
                    <Button small variant="secondary" onClick={() => void download(m)}>{t.download}</Button>
                  </>
                )}
                <Button small variant="danger" onClick={() => setToDelete(m)}>
                  {messages.common.delete}
                  <span className="visually-hidden">: {m.label ?? t.kinds[m.kind]}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={viewing !== null} title={viewing?.item.label ?? t.kinds[viewing?.item.kind ?? "image"]} onClose={() => setViewing(null)}>
        {viewing?.item.kind === "image" && <img src={viewing.url} alt={viewing.item.label ?? t.kinds.image} />}
        {viewing?.item.kind === "audio" && <audio controls src={viewing.url} />}
        {viewing?.item.kind === "video" && <video controls src={viewing.url} style={{ maxInlineSize: "100%" }} />}
        <div className="row" style={{ marginBlockStart: "1rem" }}>
          <Button onClick={() => setViewing(null)}>{messages.common.close}</Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        title={messages.common.delete}
        message={t.deleteConfirm}
        confirmLabel={messages.common.delete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await api("DELETE", `/vault/media/${toDelete.id}`);
          await reload();
        }}
      />
    </div>
  );
}
