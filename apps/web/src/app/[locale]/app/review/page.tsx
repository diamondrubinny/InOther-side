"use client";

import { useEffect, useState } from "react";
import { REJECT_REASONS } from "@inother/shared";
import { ReauthDialog } from "@/components/Dialog";
import { Alert, Button, EmptyState, Loading, SelectField } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { api, ApiError, fetchBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

interface Pending { id: string; legatorName: string; dateOfDeath: string; createdAt: string }

/** Staff-only. The API returns 404 to everyone else; this page is just the UI. */
export default function ReviewPage() {
  const { locale, messages } = useI18n();
  const t = messages.release;
  useDocumentTitle(t.reviewTitle);
  const { me } = useAuth();
  const { data, error, loading, reload } = useApi<{ items: Pending[] }>("/admin/release-requests");
  const [reauth, setReauth] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [fb, setFb] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setFb(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") setReauth(true);
      else setFb(errorMessage(messages, err instanceof ApiError ? err.code : undefined));
    }
  };

  useEffect(() => {
    if (error?.code === "reauth_required") setReauth(true);
  }, [error]);

  return (
    <div className="stack">
      <h1>{t.reviewTitle}</h1>
      {fb && <Alert kind="error">{fb}</Alert>}
      {loading && <Loading />}
      {error && error.code !== "reauth_required" && <Alert kind="error">{error.status === 404 ? messages.notFound.title : errorMessage(messages, error.code)}</Alert>}
      {data && data.items.length === 0 && <EmptyState>{t.reviewEmpty}</EmptyState>}
      {data && data.items.length > 0 && (
        <ul className="plain">
          {data.items.map((r) => (
            <li key={r.id} className="card stack">
              <p><strong>{t.legator}:</strong> {r.legatorName} · <strong>{t.dateOfDeath}:</strong> {new Date(r.dateOfDeath).toLocaleDateString(locale)} · <strong>{t.reported}:</strong> {new Date(r.createdAt).toLocaleDateString(locale)}</p>
              <div className="row">
                <Button small variant="secondary" onClick={() => act(async () => {
                  const blob = await fetchBlob(`/admin/release-requests/${r.id}/document`);
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank", "noopener");
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                })}>{t.viewDocument}</Button>
                <Button small onClick={() => act(() => api("POST", `/admin/release-requests/${r.id}/approve`))}>{t.approve}</Button>
              </div>
              <div className="row">
                <SelectField label={t.rejectReason} value={reasons[r.id] ?? "document_unreadable"} onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}>
                  {REJECT_REASONS.map((x) => <option key={x} value={x}>{t.rejectReasons[x]}</option>)}
                </SelectField>
                <Button small variant="danger" onClick={() => act(() => api("POST", `/admin/release-requests/${r.id}/reject`, { reason: reasons[r.id] ?? "document_unreadable" }))}>{t.reject}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ReauthDialog open={reauth} mfaEnabled={me?.mfaEnabled ?? false} onClose={() => setReauth(false)} onDone={() => { setReauth(false); void reload(); }} />
    </div>
  );
}
