"use client";

import { StoryForm } from "@/components/StoryForm";
import { useI18n } from "@/i18n/client";
import { useDocumentTitle } from "@/lib/use-title";

export default function NewStoryPage() {
  const { messages } = useI18n();
  useDocumentTitle(messages.stories.new);
  return (
    <div className="stack">
      <h1>{messages.stories.new}</h1>
      <StoryForm />
    </div>
  );
}
