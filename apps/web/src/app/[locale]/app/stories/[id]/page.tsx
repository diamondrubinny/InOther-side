"use client";

import { useParams } from "next/navigation";
import { StoryForm } from "@/components/StoryForm";
import { Alert, Loading } from "@/components/ui";
import { errorMessage } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { Story } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDocumentTitle } from "@/lib/use-title";

const UUID = /^[0-9a-f-]{36}$/i;

export default function EditStoryPage() {
  const { messages } = useI18n();
  useDocumentTitle(messages.stories.editTitle);
  const params = useParams<{ id: string }>();
  const id = UUID.test(params.id) ? params.id : null;
  const { data, error, loading } = useApi<Story>(id ? `/vault/stories/${id}` : null);

  if (!id) return <Alert kind="error">{messages.notFound.title}</Alert>;
  if (loading) return <Loading />;
  if (error || !data) return <Alert kind="error">{error?.status === 404 ? messages.notFound.title : errorMessage(messages, error?.code)}</Alert>;
  return (
    <div className="stack">
      <h1>{messages.stories.editTitle}</h1>
      <StoryForm initial={data} />
    </div>
  );
}
