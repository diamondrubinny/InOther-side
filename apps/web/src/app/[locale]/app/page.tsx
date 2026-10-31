"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Checkbox, Loading, ProgressBar } from "@/components/ui";
import { errorMessage, format } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { VaultSummary } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

export default function DashboardPage() {
  const { locale, messages } = useI18n();
  const t = messages.dashboard;
  useDocumentTitle(t.title);
  const { me } = useAuth();
  const { data: vault, error, loading, reload } = useApi<VaultSummary>("/vault");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (loading) return <Loading />;

  if (error?.status === 404) {
    return (
      <section className="card stack" aria-labelledby="create-title">
        <h1 id="create-title">{t.createTitle}</h1>
        <p>{t.createText}</p>
        <p className="muted small">{messages.common.aiNotice}</p>
        <Checkbox label={t.consent} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {createError && <Alert kind="error">{createError}</Alert>}
        <div>
          <Button
            busy={busy}
            disabled={!consent}
            onClick={async () => {
              setBusy(true);
              setCreateError(null);
              try {
                await api("POST", "/vault", { consentToProcessing: true });
                await reload();
              } catch (err) {
                setCreateError(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.create}
          </Button>
        </div>
      </section>
    );
  }
  if (error || !vault) return <Alert kind="error">{errorMessage(messages, error?.code)}</Alert>;

  const c = vault.completeness;
  const checklist = [
    { done: c.checklist.hasBeneficiary, label: t.checkBeneficiary, href: "people" },
    { done: c.checklist.hasExecutor, label: t.checkExecutor, href: "people" },
    { done: c.checklist.hasSecondExecutor, label: t.checkSecondExecutor, href: "people" },
    { done: c.checklist.hasOpeningMessage, label: t.checkOpening, href: "settings" },
  ];
  const status =
    vault.status === "never_release" ? t.statusNeverRelease : vault.status === "building" ? t.statusBuilding : t.statusLocked;

  return (
    <div className="stack">
      <h1>{format(t.welcome, { name: me?.displayName ?? "" })}</h1>
      <p className="muted">
        {t.status}: {status}
      </p>

      <section className="card stack" aria-labelledby="progress-title">
        <h2 id="progress-title">{t.completeness}</h2>
        <ProgressBar value={c.percent} label={t.completeness} />
        <p>{format(t.answeredOf, { answered: c.answered, total: c.totalQuestions })}</p>
        <div>
          <Link className="btn" href={`/${locale}/app/questions`}>{t.continue}</Link>
        </div>
      </section>

      <section className="grid" aria-label={t.title}>
        {[
          [t.countAnswers, vault.counts.answers],
          [t.countStories, vault.counts.stories],
          [t.countMedia, vault.counts.media],
          [t.countBeneficiaries, vault.counts.beneficiaries],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <div className="stat">{value}</div>
            <div className="muted">{label}</div>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="checklist-title">
        <h2 id="checklist-title">{t.checklistTitle}</h2>
        <ul className="plain">
          {checklist.map((item) => (
            <li key={item.label} className="row">
              <span className={`badge ${item.done ? "ok" : ""}`}>{item.done ? `✓ ${t.done}` : t.todo}</span>
              {item.done ? <span>{item.label}</span> : <Link href={`/${locale}/app/${item.href}`}>{item.label}</Link>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
