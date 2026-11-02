"use client";

import Link from "next/link";
import { SuggestQuestion } from "@/components/SuggestQuestion";
import { Alert, EmptyState, Loading } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

export default function InheritancesPage() {
  const { locale, messages } = useI18n();
  const t = messages.release;
  useDocumentTitle(t.inheritancesTitle);
  const { data, error, loading } = useApi<{ items: { vaultId: string; legatorName: string; released: boolean; canSuggest?: boolean }[] }>("/inheritances");
  return (
    <div className="stack">
      <h1>{t.inheritancesTitle}</h1>
      {loading && <Loading />}
      {error && <Alert kind="error">{errorMessage(messages, error.code)}</Alert>}
      {data && data.items.length === 0 && <EmptyState>{t.inheritancesEmpty}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="plain">
          {data.items.map((i) => (
            <li key={i.vaultId} className="card">
              <div className="row spread">
                <strong>{i.legatorName}</strong>
                {i.released ? (
                  <Link className="btn small" href={`/${locale}/app/inheritances/${i.vaultId}`}>
                    {t.open}<span className="visually-hidden">: {i.legatorName}</span>
                  </Link>
                ) : (
                  <span className="badge">{t.notYetReleased}</span>
                )}
              </div>
              {i.canSuggest && <SuggestQuestion vaultId={i.vaultId} legatorName={i.legatorName} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
