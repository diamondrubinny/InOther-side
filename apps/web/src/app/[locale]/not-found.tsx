"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";

export default function NotFound() {
  const { locale, messages } = useI18n();
  return (
    <div className="container section narrow">
      <h1>{messages.notFound.title}</h1>
      <p>{messages.notFound.text}</p>
      <Link className="btn" href={`/${locale}`}>{messages.notFound.back}</Link>
    </div>
  );
}
