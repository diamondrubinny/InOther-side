"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { useAuth } from "@/lib/auth";
import { AccessibilityMenu } from "./AccessibilityMenu";
import { CookieSettings } from "./CookieSettings";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function SiteHeader() {
  const { locale, messages } = useI18n();
  const { me } = useAuth();
  return (
    <header className="site-header">
      <div className="container">
        <Link href={`/${locale}`} className="brand">
          {messages.meta.siteName}
        </Link>
        <nav aria-label={messages.nav.main} className="header-tools">
          {me ? (
            <Link className="btn small" href={`/${locale}/app`}>
              {messages.nav.dashboard}
            </Link>
          ) : (
            <>
              <Link className="btn small secondary" href={`/${locale}/login`}>
                {messages.nav.login}
              </Link>
              <Link className="btn small" href={`/${locale}/register`}>
                {messages.nav.register}
              </Link>
            </>
          )}
          <LanguageSwitcher />
          <AccessibilityMenu />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { locale, messages } = useI18n();
  const f = messages.footer;
  return (
    <footer className="site-footer">
      <div className="container">
        <ul>
          <li><Link href={`/${locale}/privacy`}>{f.privacy}</Link></li>
          <li><Link href={`/${locale}/terms`}>{f.terms}</Link></li>
          <li><Link href={`/${locale}/cookies`}>{f.cookies}</Link></li>
          <li><Link href={`/${locale}/accessibility`}>{f.accessibility}</Link></li>
        </ul>
        <div className="footer-buttons">
          <CookieSettings />
        </div>
        <p className="small">{f.crisis}</p>
        <p className="small muted">
          © {new Date().getFullYear()} {messages.meta.siteName}. {f.rights}
        </p>
      </div>
    </footer>
  );
}
