import type { MetadataRoute } from "next";
import { SUPPORTED_LOCALES } from "@inother/shared";
import { SITE_URL } from "@/lib/config";

const PUBLIC_PATHS = ["", "/login", "/register", "/promises", "/privacy", "/terms", "/cookies", "/accessibility"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.flatMap((path) =>
    SUPPORTED_LOCALES.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`])) },
    })),
  );
}
