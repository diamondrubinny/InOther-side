"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Loading } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ReleaseAlert } from "@/components/ReleaseAlert";

/**
 * Personal area. Data is fetched in the browser with the HttpOnly session cookie and is never
 * server-rendered or cached. Access control is enforced by the API on every request; this
 * guard only improves the UX by redirecting signed-out visitors.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { locale, messages } = useI18n();
  const { me, loading, setMe } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const n = messages.nav;

  useEffect(() => {
    if (!loading && !me) router.replace(`/${locale}/login`);
  }, [loading, me, locale, router]);

  if (loading || !me) {
    return (
      <div className="container section">
        <Loading />
      </div>
    );
  }

  const base = `/${locale}/app`;
  const items = [
    { href: base, label: n.dashboard },
    { href: `${base}/questions`, label: n.questions },
    { href: `${base}/interview`, label: messages.interview.nav },
    { href: `${base}/stories`, label: n.stories },
    { href: `${base}/media`, label: n.media },
    { href: `${base}/people`, label: n.people },
    { href: `${base}/persona-settings`, label: messages.persona.navPersona },
    { href: `${base}/executor`, label: messages.release.navExecutor },
    { href: `${base}/inheritances`, label: messages.release.navInheritances },
    ...(me.role === "staff" ? [{ href: `${base}/review`, label: messages.release.navReview }] : []),
    { href: `${base}/settings`, label: n.settings },
  ];
  const isCurrent = (href: string) => (href === base ? pathname === base : pathname.startsWith(href));

  const logout = async () => {
    try {
      await api("POST", "/auth/logout");
    } finally {
      setMe(null);
      router.replace(`/${locale}`);
    }
  };

  return (
    <div className="container app-layout">
      <nav className="app-nav" aria-label={n.app}>
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="btn link" onClick={logout}>
              {n.logout}
            </button>
          </li>
        </ul>
      </nav>
      <div className="stack">
        <ReleaseAlert />
        {children}
      </div>
    </div>
  );
}
