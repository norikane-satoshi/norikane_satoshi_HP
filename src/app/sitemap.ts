import type { MetadataRoute } from "next";
import { listPublishedNotes } from "@/lib/notion/server/fetch-note";
import { SITE_URL } from "@/lib/site-brand";
import { LOCALES, languageAlternates, localizedPath } from "@/lib/i18n/locales";

export const dynamic = "force-static";

const STATIC_PATHS = ["/", "/privacy", "/terms"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages = STATIC_PATHS.map((path) => ({
    url: new URL(path, SITE_URL).toString(),
  }));
  const notes = await listPublishedNotes().catch(() => []);

  const pages = [
    ...staticPages,
    ...notes.map((note) => ({
      url: new URL(`/notes/${note.slug}`, SITE_URL).toString(),
      lastModified: new Date(note.lastEditedTime),
    })),
  ];
  return pages.flatMap((page) => {
    const path = new URL(page.url).pathname;
    return (["ja", ...LOCALES] as const).map((locale) => ({
      ...page, url: new URL(localizedPath(path, locale), SITE_URL).href,
      alternates: { languages: languageAlternates(path) },
    }));
  });
}
