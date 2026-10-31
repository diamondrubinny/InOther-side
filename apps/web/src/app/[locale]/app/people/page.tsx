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

type Kind = "beneficiaries" | "executors";

function PersonSection({ kind }: { kind: Kind }) {
  const { messages } = useI18n();
  const t = messages.people;
  const isBeneficiary = kind === "beneficiaries";
  const { data, error, loading, reload } = useApi<{ items: Person[] }>(`/vault/${kind}`);
  const [form, setForm] = useState({ name: "", email: "", relation: "child" as Relation, notifyBeforeDeath: false });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Person | null>(null);
  const headingId = `${kind}-title`;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setFormError(messages.errors.validation_failed);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const body = isBeneficiary ? form : { name: form.name, email: form.email, relation: form.relation };
      await api("POST", `/vault/${kind}`, body);
      setForm({ name: "", email: "", relation: "child", notifyBeforeDeath: false });
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
      {loading && <Loading />}
      {error && <Alert kind="error">{errorMessage(messages, error.code)}</Alert>}
      {data && data.items.length === 0 && <EmptyState>{isBeneficiary ? t.emptyBeneficiaries : t.emptyExecutors}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="plain">
          {data.items.map((p) => (
            <li key={p.id} className="row spread">
              <span>
                <strong>{p.name}</strong> · {t.relations[p.relation]} · <span className="ltr">{p.email}</span>
              </span>
              <Button small variant="danger" onClick={() => setToDelete(p)}>
                {messages.common.delete}
                <span className="visually-hidden">: {p.name}</span>
              </Button>
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
          <Checkbox label={t.notifyBeforeDeath} checked={form.notifyBeforeDeath} onChange={(e) => setForm({ ...form, notifyBeforeDeath: e.target.checked })} />
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
