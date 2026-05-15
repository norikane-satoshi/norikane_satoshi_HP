import type { MetadataRoute } from "next";
import { listPublishedNotes } from "@/lib/notion/server/fetch-note";

export const dynamic = "force-static";

const SITE_URL = "https://norikane.studio";

const FALLBACK_NOTE_SLUGS = ["correction", "grading", "filmlook"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const root: MetadataRoute.Sitemap[number] = {
    url: new URL("/", SITE_URL).toString(),
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 1.0,
  };

  try {
    const notes = await listPublishedNotes();
    return [
      root,
      ...notes.map((note) => ({
        url: new URL(`/notes/${note.slug}`, SITE_URL).toString(),
        lastModified: new Date(note.lastEditedTime),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
    ];
  } catch {
    return [
      root,
      ...FALLBACK_NOTE_SLUGS.map((slug) => ({
        url: new URL(`/notes/${slug}`, SITE_URL).toString(),
        lastModified: new Date(),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
    ];
  }
}
