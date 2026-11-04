import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  EXTERNAL_NOTES,
  NOTE_THUMBNAILS,
  buildHomeNoteCards,
} from "@/lib/hp/home-notes"

const correction = {
  id: "note-correction",
  slug: "correction",
  title: "カラーコレクションの因数分解",
  createdTime: "2026-04-14T15:28:13.060Z",
  lastEditedTime: "2026-10-10T07:33:10.328Z",
}

describe("buildHomeNoteCards", () => {
  it("lists Notion notes and external articles newest first with thumbnails", () => {
    const cards = buildHomeNoteCards([correction])

    expect(cards.map((card) => [card.label, card.href, card.external])).toEqual([
      ["PRONEWS", "https://jp.pronews.com/review/202608150955772789.html", true],
      ["Note 01", "/notes/correction", false],
    ])
    expect(cards.every((card) => card.thumbnailSrc)).toBe(true)
  })

  it("numbers own notes from the newest one", () => {
    const older = { ...correction, id: "a", slug: "a", createdTime: "2026-01-01T00:00:00.000Z" }
    const cards = buildHomeNoteCards([older, correction]).filter((card) => !card.external)

    expect(cards.map((card) => [card.href, card.label])).toEqual([
      ["/notes/correction", "Note 01"],
      ["/notes/a", "Note 02"],
    ])
    expect(cards[1]?.thumbnailSrc).toBeNull()
  })

  it("points every thumbnail at a file in public/", () => {
    const sources = [
      ...Object.values(NOTE_THUMBNAILS),
      ...EXTERNAL_NOTES.map((note) => note.thumbnailSrc),
    ]
    for (const src of sources) {
      expect(src).toMatch(/^\//)
      expect(existsSync(path.join(process.cwd(), "public", src ?? ""))).toBe(true)
    }
  })
})
