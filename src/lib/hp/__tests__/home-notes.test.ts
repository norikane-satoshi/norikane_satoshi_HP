import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  EXTERNAL_NOTES,
  NOTE_SETTINGS,
  getNoteLabel,
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
  it("uses configured publication dates without treating Notion creation as publication", () => {
    const column = { ...correction, id: "ai", slug: "ai-thoughts" }
    const unconfigured = { ...correction, id: "new", slug: "new" }
    const cards = buildHomeNoteCards([correction, column, unconfigured])

    expect(cards.find((card) => card.key === correction.id)?.publishedAt).toBe("2026-04-23")
    expect(cards.find((card) => card.key === "ai")?.publishedAt).toBe("2026-11-22")
    expect(cards.find((card) => card.external)?.publishedAt).toBe("2026-08-15")
    expect(cards.find((card) => card.key === "new")?.publishedAt).toBeUndefined()
  })

  it("lists Notion notes and external articles newest first with thumbnails", () => {
    const cards = buildHomeNoteCards([correction])

    expect(cards.map((card) => [card.label, card.href, card.external])).toEqual([
      ["PRONEWS", "https://jp.pronews.com/review/202608150955772789.html", true],
      ["Note 01", "/notes/correction", false],
    ])
    expect(cards.every((card) => card.thumbnailSrc)).toBe(true)
  })

  it("keeps older note numbers when newer notes are published, regardless of input order", () => {
    const newer = { ...correction, id: "new", slug: "new", createdTime: "2026-11-22T00:00:00.000Z" }
    const before = buildHomeNoteCards([correction]).find((card) => card.href === "/notes/correction")
    const cards = buildHomeNoteCards([newer, correction]).filter((card) => !card.external)

    expect(cards.map((card) => [card.href, card.label])).toEqual([
      ["/notes/new", "Note 02"],
      ["/notes/correction", "Note 01"],
    ])
    expect(cards[1]?.label).toBe(before?.label)
    expect(cards[0]?.thumbnailSrc).toBeNull()
  })

  it("numbers columns independently without consuming a note number", () => {
    const column = { ...correction, id: "ai", slug: "ai-thoughts", createdTime: "2026-11-01T00:00:00.000Z" }
    const newer = { ...correction, id: "new", slug: "new", createdTime: "2026-11-22T00:00:00.000Z" }
    const cards = buildHomeNoteCards([newer, column, correction]).filter((card) => !card.external)

    expect(cards.map((card) => [card.href, card.label])).toEqual([
      ["/notes/new", "Note 02"],
      ["/notes/ai-thoughts", "Column 01"],
      ["/notes/correction", "Note 01"],
    ])
    expect(getNoteLabel("ai-thoughts", [column])).toBe("Column 01")
    expect(cards[1]?.thumbnailSrc).toBe("/notes/thumbnails/ai-thoughts-diagram.png")
  })

  it("counts later columns separately in oldest-first order", () => {
    const settings = NOTE_SETTINGS as Record<string, { kind?: "note" | "column" }>
    settings["next-column"] = { kind: "column" }
    try {
      const first = { ...correction, id: "ai", slug: "ai-thoughts" }
      const next = { ...correction, id: "next", slug: "next-column", createdTime: "2026-11-22T00:00:00.000Z" }
      expect(getNoteLabel(first.slug, [first])).toBe("Column 01")
      expect(getNoteLabel(first.slug, [next, correction, first])).toBe("Column 01")
      expect(getNoteLabel(next.slug, [next, correction, first])).toBe("Column 02")
      expect(getNoteLabel(correction.slug, [next, correction, first])).toBe("Note 01")
    } finally {
      delete settings["next-column"]
    }
  })

  it("breaks creation-time ties by slug without changing the input", () => {
    const other = { ...correction, id: "z", slug: "z" }
    const notes = [other, correction]
    expect(getNoteLabel("correction", notes)).toBe("Note 01")
    expect(getNoteLabel("z", notes)).toBe("Note 02")
    expect(notes).toEqual([other, correction])
  })

  it("points every thumbnail at a file in public/", () => {
    const sources = [
      ...Object.values(NOTE_SETTINGS).flatMap((settings) => settings.thumbnailSrc ? [settings.thumbnailSrc] : []),
      ...EXTERNAL_NOTES.map((note) => note.thumbnailSrc),
    ]
    for (const src of sources) {
      expect(src).toMatch(/^\//)
      expect(existsSync(path.join(process.cwd(), "public", src ?? ""))).toBe(true)
    }
  })
})
