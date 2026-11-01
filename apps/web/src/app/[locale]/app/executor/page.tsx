"use client";

import { useState, type FormEvent } from "react";
import { RELEASE_DOCUMENT_MAX_BYTES, RELEASE_DOCUMENT_TYPES } from "@inother/shared";
import { Alert, Button, Checkbox, EmptyState, Loading, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError, uploadWithProgress } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

interface Role {
  vaultId: string;
  legatorName: string;
  released: boolean;
  openReport: { id: string; status: string; reportedByMe: boolean; canConfirm: boolean; waitUntil: string | null } | null;
}

function RoleCard({ role, onChange }: { role: Role; onChange: () => Promise<void> }) {
  const { locale, messages } = useI18n();
  const t = messages.release;
  const [date, setDate] = useState("");
  const [afterSunset, setAfterSunset] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = role.openReport;
  const fail = (err: unknown) => setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));

  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!date || !file) return setError(messages.errors.validation_failed);
    if (file.size > RELEASE_DOCUMENT_MAX_BYTES) return setError(messages.errors.file_too_large);
    if (!(RELEASE_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return setError(messages.errors.content_type_not_allowed);
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>("POST", `/executor/vaults/${role.vaultId}/reports`, { dateOfDeath: date, afterSunset });
      await uploadWithProgress(`/executor/reports/${created.id}/document`, file, file.type, () => {});
      await onChange();
    } catch (err) {
      fail(err);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const uploadOnly = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !report) return;
    setBusy(true);
    setError(null);
    try {
      await uploadWithProgress(`/executor/reports/${report.id}/document`, file, file.type, () => {});
      await onChange();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const fileField = (
    <div className="field">
      <label htmlFor={`cert-${role.vaultId}`}>{t.certificate}</label>
      <input id={`cert-${role.vaultId}`} type="file" accept={RELEASE_DOCUMENT_TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    </div>
  );

  return (
    <li className="card stack">
      <h2 style={{ fontSize: "1.15rem" }}>{format(t.chosenBy, { name: role.legatorName })}</h2>
      {error && <Alert kind="error">{error}</Alert>}
      {role.released && <p className="badge ok">{t.reportStatuses.released}</p>}
      {report && (
        <p>
          <span className="badge">{t.reportStatuses[report.status as keyof typeof t.reportStatuses]}</span>
          {report.waitUntil && <span className="muted small"> · {new Date(report.waitUntil).toLocaleDateString(locale)}</span>}
        </p>
      )}
      {report?.status === "awaiting_document" && report.reportedByMe && (
        <form className="stack" onSubmit={uploadOnly} noValidate>
          {fileField}
          <div><Button type="submit" busy={busy} disabled={!file}>{t.uploadCertificate}</Button></div>
        </form>
      )}
      {report?.canConfirm && (
        <div>
          <Button busy={busy} onClick={async () => { setBusy(true); try { await api("POST", `/executor/reports/${report.id}/confirm`); await onChange(); } catch (err) { fail(err); } finally { setBusy(false); } }}>
            {t.confirmSecond}
          </Button>
        </div>
      )}
      {!report && !role.released && (
        <details>
          <summary>{t.reportTitle}</summary>
          <form className="stack" onSubmit={submitReport} noValidate style={{ marginBlockStart: "1rem" }}>
            <p className="muted">{format(t.reportText, { name: role.legatorName })}</p>
            <TextField label={t.dateOfDeath} type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} required />
            <Checkbox label={t.afterSunset} checked={afterSunset} onChange={(e) => setAfterSunset(e.target.checked)} />
            {fileField}
            <div><Button type="submit" busy={busy}>{t.submitReport}</Button></div>
          </form>
        </details>
      )}
    </li>
  );
}

export default function ExecutorPage() {
  const { messages } = useI18n();
  const t = messages.release;
  useDocumentTitle(t.executorTitle);
  const { data, error, loading, reload } = useApi<{ items: Role[] }>("/executor/vaults");
  return (
    <div className="stack">
      <h1>{t.executorTitle}</h1>
      <p className="muted">{t.executorIntro}</p>
      {loading && <Loading />}
      {error && <Alert kind="error">{errorMessage(messages, error.code)}</Alert>}
      {data && data.items.length === 0 && <EmptyState>{t.executorEmpty}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="plain">{data.items.map((r) => <RoleCard key={r.vaultId} role={r} onChange={reload} />)}</ul>
      )}
    </div>
  );
}
