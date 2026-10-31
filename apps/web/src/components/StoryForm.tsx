"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, RadioGroup, TextArea, TextField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import type { Person, Story } from "@/lib/types";
import { useApi } from "@/lib/use-api";

type Draft = Omit<Story, "id">;

const EMPTY: Draft = {
  title: "",
  body: "",
  audience: "all",
  beneficiaryIds: [],
  releaseRule: "on_release",
  releaseAt: null,
  topic: null,
  delivery: "original_only",
  sensitivityAck: false,
};

export function StoryForm({ initial }: { initial?: Story }) {
  const { locale, messages } = useI18n();
  const t = messages.stories;
  const router = useRouter();
  const people = useApi<{ items: Person[] }>("/vault/beneficiaries");
  const [draft, setDraft] = useState<Draft>(initial ? { ...initial } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      ...draft,
      beneficiaryIds: draft.audience === "specific" ? draft.beneficiaryIds : [],
      releaseAt: draft.releaseRule === "date" ? draft.releaseAt : null,
      topic: draft.releaseRule === "on_topic" ? draft.topic : null,
    };
    try {
      if (initial) await api("PUT", `/vault/stories/${initial.id}`, body);
      else await api("POST", "/vault/stories", body);
      router.push(`/${locale}/app/stories`);
    } catch (err) {
      setError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
      setBusy(false);
    }
  };

  const beneficiaries = people.data?.items ?? [];

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && <Alert kind="error">{error}</Alert>}
      <TextField label={t.titleLabel} value={draft.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} />
      <TextArea label={t.bodyLabel} value={draft.body} onChange={(e) => set("body", e.target.value)} required maxLength={50000} rows={10} />

      <RadioGroup
        legend={t.audience}
        name="audience"
        value={draft.audience}
        onChange={(v) => set("audience", v)}
        options={[
          { value: "all", label: t.audienceAll },
          { value: "specific", label: t.audienceSpecific },
        ]}
      />
      {draft.audience === "specific" && (
        <fieldset>
          <legend>{t.chooseBeneficiaries}</legend>
          {beneficiaries.length === 0 && <p className="muted">{t.noBeneficiaries}</p>}
          {beneficiaries.map((b) => (
            <Checkbox
              key={b.id}
              label={`${b.name} (${messages.people.relations[b.relation]})`}
              checked={draft.beneficiaryIds.includes(b.id)}
              onChange={(e) =>
                set("beneficiaryIds", e.target.checked ? [...draft.beneficiaryIds, b.id] : draft.beneficiaryIds.filter((id) => id !== b.id))
              }
            />
          ))}
        </fieldset>
      )}

      <RadioGroup
        legend={t.release}
        name="release"
        value={draft.releaseRule}
        onChange={(v) => set("releaseRule", v)}
        options={[
          { value: "on_release", label: t.releaseOnRelease },
          { value: "date", label: t.releaseDate },
          { value: "on_topic", label: t.releaseTopic },
        ]}
      />
      {draft.releaseRule === "date" && (
        <TextField label={t.releaseDateLabel} type="date" value={draft.releaseAt ?? ""} onChange={(e) => set("releaseAt", e.target.value || null)} required />
      )}
      {draft.releaseRule === "on_topic" && (
        <TextField label={t.topicLabel} value={draft.topic ?? ""} onChange={(e) => set("topic", e.target.value || null)} required maxLength={200} />
      )}

      <RadioGroup
        legend={t.delivery}
        name="delivery"
        value={draft.delivery}
        onChange={(v) => set("delivery", v)}
        options={[
          { value: "original_only", label: t.deliveryOriginal },
          { value: "persona_tells", label: t.deliveryPersona },
        ]}
      />

      <div className="alert warning stack">
        <h2 style={{ fontSize: "1.05rem" }}>{t.sensitivityTitle}</h2>
        <p>{t.sensitivityText}</p>
        <Checkbox label={t.sensitivityAck} checked={draft.sensitivityAck} onChange={(e) => set("sensitivityAck", e.target.checked)} />
      </div>

      <div className="row">
        <Button type="submit" busy={busy}>{messages.common.save}</Button>
        <Button variant="secondary" onClick={() => router.push(`/${locale}/app/stories`)}>{messages.common.cancel}</Button>
      </div>
    </form>
  );
}
