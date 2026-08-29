import type { MetadataRoute } from "next";
import { listPublishedNotes } from "@/lib/notion/server/fetch-note";

export const dynamic = "force-static";

const SITE_URL = "https://norikane.studio";

const LEGAL_PAGES = ["/privacy", "/terms"] as const;

function localizedEntry(path: string, locale: "ja" | "en") {
  const localizedPath = `/${locale}${path === "/" ? "" : path}`
  return {
    url: new URL(localizedPath, SITE_URL).toString(),
    alternates: {
      languages: {
        ja: new URL(`/ja${path === "/" ? "" : path}`, SITE_URL).toString(),
        en: new URL(`/en${path === "/" ? "" : path}`, SITE_URL).toString(),
      },
    },
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const roots = (["ja", "en"] as const).map((locale) => ({
    ...localizedEntry("/", locale),
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 1.0,
  }))
  const legalPages = LEGAL_PAGES.flatMap((path) =>
    (["ja", "en"] as const).map((locale) => ({
      ...localizedEntry(path, locale),
      lastModified: new Date(),
      changeFrequency: "yearly" as const,
      priority: 0.4,
    })),
  )

  try {
    const notes = (await Promise.all([
      listPublishedNotes("ja"),
      listPublishedNotes("en"),
    ])).flat()
    return [
      ...roots,
      ...legalPages,
      ...notes.map((note) => ({
        ...localizedEntry(`/notes/${note.slug}`, note.locale),
        lastModified: new Date(note.lastEditedTime),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
    ];
  } catch {
    return [...roots, ...legalPages];
  }
}
