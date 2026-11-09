"use client";

import { useParams } from "next/navigation";
import { LegacyBook } from "@/components/LegacyBook";
import { Alert } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export default function InheritanceBookPage() {
  const { messages } = useI18n();
  const { vaultId } = useParams<{ vaultId: string }>();
  if (!/^[0-9a-f-]{36}$/i.test(vaultId)) return <Alert kind="error">{messages.notFound.title}</Alert>;
  return <LegacyBook mode="beneficiary" vaultId={vaultId} />;
}
