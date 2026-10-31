import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, textDirection, type Locale } from "@inother/shared";
import { LEGAL, type LegalDoc } from "@/content/legal";
import { format, getMessages } from "@/i18n";

/** Legal documents exist in Hebrew and English; other locales show English with a notice. */
function resolve(doc: LegalDoc, rawLocale: string) {
  if (!isLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const lang: "he" | "en" = locale === "he" ? "he" : "en";
  return { content: LEGAL[doc][lang], lang, locale, messages: getMessages(locale), fallback: locale !== "he" && locale !== "en" };
}

export async function legalMetadata(doc: LegalDoc, params: Promise<{ locale: string }>): Promise<Metadata> {
  const { locale } = await params;
  const { content } = resolve(doc, locale);
  return { title: content.title, alternates: { canonical: `/${locale}/${doc}` } };
}

export async function LegalPage({ doc, params }: { doc: LegalDoc; params: Promise<{ locale: string }> }) {
  const { content, lang, locale, messages, fallback } = resolve(doc, (await params).locale);
  return (
    <article className="container section legal" lang={lang} dir={textDirection(lang)}>
      <h1>{content.title}</h1>
      <div className="alert warning" role="note" lang={locale} dir={textDirection(locale)}>
        <p style={{ margin: 0 }}>{messages.legal.draft}</p>
        {fallback && <p style={{ margin: 0 }}>{messages.legal.fallback}</p>}
      </div>
      <p className="muted small">{format(messages.legal.updated, { date: content.updated })}</p>
      {content.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
