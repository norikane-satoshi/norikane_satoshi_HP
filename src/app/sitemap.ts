import type { MetadataRoute } from "next";
import { listPublishedNotes } from "@/lib/notion/fetch-note";

const SITE_URL = "https://norikane.studio";

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
    return [root];
  }
}
