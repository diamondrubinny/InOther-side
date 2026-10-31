"use client";

import { usePathname, useRouter } from "next/navigation";
import { useId } from "react";
import { LOCALE_INFO, SUPPORTED_LOCALES, isLocale, type Locale } from "@inother/shared";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function LanguageSwitcher() {
  const { locale, messages } = useI18n();
  const { me, setMe } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const id = useId();

  const change = async (next: Locale) => {
    // Remember the choice (functional cookie, 1 year) and keep the signed-in profile in sync.
    document.cookie = `inother_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    if (me) {
      try {
        await api("PATCH", "/me", { locale: next });
        setMe({ ...me, locale: next });
      } catch {
        /* non-blocking */
      }
    }
    const parts = pathname.split("/");
    if (isLocale(parts[1])) parts[1] = next;
    router.push(parts.join("/") || `/${next}`);
  };

  return (
    <div className="row">
      <label htmlFor={id} className="visually-hidden">
        {messages.nav.language}
      </label>
      <select
        id={id}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) void change(e.target.value);
        }}
        style={{ inlineSize: "auto", minBlockSize: 40 }}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_INFO[l].nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
