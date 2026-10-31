import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SUPPORTED_LOCALES, isLocale, textDirection } from "@inother/shared";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getMessages } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import { AuthProvider } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import "../globals.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMessages(locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${m.meta.siteName} | ${m.meta.tagline}`, template: `%s | ${m.meta.siteName}` },
    description: m.meta.description,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `/${l}`])),
    },
    openGraph: { type: "website", siteName: m.meta.siteName, title: m.meta.siteName, description: m.meta.description, locale },
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#15181b" },
  ],
};

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Reading the nonce makes rendering dynamic, so every response gets its own CSP nonce.
  await headers();
  const messages = getMessages(locale);
  const dir = textDirection(locale);
  return (
    <html lang={locale} dir={dir}>
      <body>
        <I18nProvider value={{ locale, dir, messages }}>
          <AuthProvider>
            <a href="#main" className="skip-link">
              {messages.nav.skipToContent}
            </a>
            <SiteHeader />
            <main id="main" tabIndex={-1}>
              {children}
            </main>
            <SiteFooter />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
