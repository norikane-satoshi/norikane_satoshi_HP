import { describe, expect, it } from "vitest"

import { buildNoteJsonLd } from "@/lib/hp/structured-data"
import { extractNoteExcerpt } from "@/lib/notes/domain/excerpt"
import type { BlockWithChildren } from "@/lib/notion/server/types"

function paragraph(text: string): BlockWithChildren {
  return {
    type: "paragraph",
    paragraph: { rich_text: text ? [{ plain_text: text }] : [] },
  } as unknown as BlockWithChildren
}

describe("search engine metadata", () => {
  it("dates an article only from its verified publication date", () => {
    const base = { slug: "correction", title: "題", description: "抜粋", lastEditedTime: "2026-10-10T07:33:00.000Z" }
    expect(buildNoteJsonLd(base)).not.toHaveProperty("datePublished")
    expect(buildNoteJsonLd({ ...base, publishedAt: "2026-04-23" })).toMatchObject({
      url: "https://norikane.studio/notes/correction",
      datePublished: "2026-04-23",
    })
  })

  it("builds the description from the opening paragraphs, skipping blanks and diagram markers", () => {
    const blocks = [paragraph(""), paragraph("[[diagram:correction-space-choice]]"), paragraph("最初の段落。"), paragraph("次の段落。")]
    expect(extractNoteExcerpt(blocks)).toBe("最初の段落。次の段落。")
    expect(extractNoteExcerpt([paragraph("あ".repeat(200))])).toBe(`${"あ".repeat(119)}…`)
  })
})
