"use client";

import { useState, type FormEvent } from "react";
import { RELATIONS, type Relation } from "@inother/shared";
import { ConfirmDialog } from "@/components/Dialog";
import { Alert, Button, Checkbox, EmptyState, Loading, SelectField, TextField } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import type { Person } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";
import { formatDualDate } from "@/lib/dates";

type Kind = "beneficiaries" | "executors";

/** Optional date of birth (schedules birthday/age letters; protects minors). */
function BirthDateEditor({ person, onSaved }: { person: Person; onSaved: () => Promise<void> }) {
  const { locale, messages } = useI18n();
  const t = messages.people;
  const [date, setDate] = useState(person.birthDate ?? "");
  const [sunset, setSunset] = useState(person.bornAfterSunset ?? false);
  const [status, setStatus] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    try {
      await api("PATCH", `/vault/beneficiaries/${person.id}`, { birthDate: date || null, bornAfterSunset: sunset });
      setStatus(t.birthDateSaved);
      await onSaved();
    } catch (err) {
      setStatus(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    }
  };
  return (
    <details className="small" style={{ marginBlockStart: "0.4rem" }}>
      <summary>
        {t.birthDate}
        {person.birthDate ? `: ${formatDualDate(person.birthDate, locale, person.bornAfterSunset)}` : ""}
        <span className="visually-hidden"> ({person.name})</span>
      </summary>
      <form className="stack" onSubmit={save} noValidate style={{ marginBlockStart: "0.5rem" }}>
        <TextField label={`${t.birthDate} · ${person.name}`} hint={t.birthDateHelp} type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
        <Checkbox label={t.bornAfterSunset} checked={sunset} onChange={(e) => setSunset(e.target.checked)} />
        <div className="row">
          <Button small type="submit">{t.saveBirthDate}</Button>
          <span role="status" className="muted">{status}</span>
        </div>
      </form>
    </details>
  );
}

function PersonSection({ kind }: { kind: Kind }) {
  const { messages } = useI18n();
  const t = messages.people;
  const isBeneficiary = kind === "beneficiaries";
  const { data, error, loading, reload } = useApi<{ items: Person[] }>(`/vault/${kind}`);
  const emptyForm = { name: "", email: "", relation: "child" as Relation, notifyBeforeDeath: false, birthDate: "", bornAfterSunset: false };
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Person | null>(null);
  const headingId = `${kind}-title`;
  const [notice, setNotice] = useState<string | null>(null);
  const invite = async (p: Person) => {
    setNotice(null);
    setFormError(null);
    try {
      await api("POST", `/vault/${kind}/${p.id}/invite`);
      setNotice(`${messages.release.inviteSent}: ${p.name}`);
      await reload();
    } catch (err) {
      setFormError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setFormError(messages.errors.validation_failed);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const body = isBeneficiary ? { ...form, birthDate: form.birthDate || null } : { name: form.name, email: form.email, relation: form.relation };
      await api("POST", `/vault/${kind}`, body);
      setForm(emptyForm);
      await reload();
    } catch (err) {
      setFormError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby={headingId}>
      <h2 id={headingId}>{isBeneficiary ? t.beneficiaries : t.executors}</h2>
      <p className="muted">{isBeneficiary ? t.beneficiariesHelp : t.executorsHelp}</p>
      {notice && <Alert kind="success">{notice}</Alert>}
      {loading && <Loading />}
      {error && <Alert kind="error">{errorMessage(messages, error.code)}</Alert>}
      {data && data.items.length === 0 && <EmptyState>{isBeneficiary ? t.emptyBeneficiaries : t.emptyExecutors}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="plain">
          {data.items.map((p) => (
            <li key={p.id} className="row spread">
              <span>
                <strong>{p.name}</strong> · {t.relations[p.relation]} · <span className="ltr">{p.email}</span>{" "}
                <span className={`badge ${p.status === "confirmed" || p.status === "accepted" ? "ok" : ""}`}>{messages.release.personStatuses[p.status]}</span>
                {isBeneficiary && <BirthDateEditor person={p} onSaved={reload} />}
              </span>
              <span className="row">
              {p.status !== "confirmed" && p.status !== "accepted" && (
                <Button small variant="secondary" onClick={() => void invite(p)}>
                  {p.status === "invited" ? messages.release.resend : messages.release.invite}
                  <span className="visually-hidden">: {p.name}</span>
                </Button>
              )}
              <Button small variant="danger" onClick={() => setToDelete(p)}>
                {messages.common.delete}
                <span className="visually-hidden">: {p.name}</span>
              </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="stack" onSubmit={add} noValidate aria-label={isBeneficiary ? t.addBeneficiary : t.addExecutor}>
        <div className="grid">
          <TextField label={t.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} autoComplete="off" />
          <TextField label={t.email} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="off" />
          <SelectField label={t.relation} value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value as Relation })}>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {t.relations[r]}
              </option>
            ))}
          </SelectField>
        </div>
        {isBeneficiary && (
          <>
            <Checkbox label={t.notifyBeforeDeath} checked={form.notifyBeforeDeath} onChange={(e) => setForm({ ...form, notifyBeforeDeath: e.target.checked })} />
            <div className="grid">
              <TextField
                label={t.birthDate}
                hint={t.birthDateHelp}
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              />
            </div>
            {form.birthDate && (
              <Checkbox label={t.bornAfterSunset} checked={form.bornAfterSunset} onChange={(e) => setForm({ ...form, bornAfterSunset: e.target.checked })} />
            )}
          </>
        )}
        {formError && <Alert kind="error">{formError}</Alert>}
        <div>
          <Button type="submit" busy={busy}>{isBeneficiary ? t.addBeneficiary : t.addExecutor}</Button>
        </div>
      </form>

      <ConfirmDialog
        open={toDelete !== null}
        title={messages.common.delete}
        message={format(t.deleteConfirm, { name: toDelete?.name ?? "" })}
        confirmLabel={messages.common.delete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await api("DELETE", `/vault/${kind}/${toDelete.id}`);
          await reload();
        }}
      />
    </section>
  );
}

export default function PeoplePage() {
  const { messages } = useI18n();
  useDocumentTitle(messages.people.title);
  return (
    <div className="stack">
      <h1>{messages.people.title}</h1>
      <PersonSection kind="beneficiaries" />
      <PersonSection kind="executors" />
    </div>
  );
}
