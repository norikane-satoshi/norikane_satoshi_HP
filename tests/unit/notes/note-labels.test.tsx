// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import HomePage from "@/app/(ja)/page"
import NotePage, { generateMetadata } from "@/app/(ja)/notes/[slug]/page"
import { getNotePublicationStatusBySlug, getPublishedNoteBySlug, listPublishedNotes } from "@/lib/notion/server/fetch-note"

vi.mock("@/components/hp/featured-works", () => ({ FeaturedWorks: () => null }))
vi.mock("@/components/hp/hero-section", () => ({ HeroSection: () => null }))
vi.mock("@/lib/notion/server/render-blocks", () => ({
  buildSlugIndex: () => new Map(),
  RenderBlocks: () => <p>Published body</p>,
}))
vi.mock("@/lib/notion/server/fetch-note", () => ({
  listPublishedNotes: vi.fn(),
  getPublishedNoteBySlug: vi.fn(),
  getNotePublicationStatusBySlug: vi.fn(),
}))

const notes = [
  { id: "new", slug: "new", title: "New note", createdTime: "2026-11-22T00:00:00.000Z", lastEditedTime: "2026-11-22T00:00:00.000Z" },
  { id: "ai", slug: "ai-thoughts", title: "AIで不安になる理由", createdTime: "2026-11-01T00:00:00.000Z", lastEditedTime: "2026-11-22T00:00:00.000Z" },
  { id: "correction", slug: "correction", title: "カラーコレクションの因数分解", createdTime: "2026-04-14T00:00:00.000Z", lastEditedTime: "2026-11-22T00:00:00.000Z" },
]

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe("published article labels", () => {
  it("renders identical labels in the real home cards and article headers", async () => {
    vi.mocked(listPublishedNotes).mockResolvedValue(notes)
    const home = render(await HomePage())
    const labels = ["Note 02", "Column 01", "Note 01"]
    for (const [index, note] of notes.entries()) {
      vi.mocked(getPublishedNoteBySlug).mockResolvedValue({ ...note, blocks: [] })
      const page = render(await NotePage({ params: Promise.resolve({ slug: note.slug }) }))
      const cardLabel = home.container.querySelector(`a[href="/notes/${note.slug}"] .hp-eyebrow > span`)
      const pageLabel = page.container.querySelector(".hp-note-header .hp-eyebrow")
      expect(cardLabel).toHaveTextContent(labels[index])
      expect(pageLabel?.textContent).toBe(cardLabel?.textContent)
      page.unmount()
    }
  })

  it("shares the approved column thumbnail after publication", async () => {
    vi.mocked(getPublishedNoteBySlug).mockResolvedValue({ ...notes[1], blocks: [] })
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "ai-thoughts" }) })
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: "https://norikane.studio/notes/thumbnails/ai-thoughts-diagram.png", alt: notes[1].title }],
    })
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: metadata.openGraph?.images })
  })

  it("keeps the unpublished column out of home cards, body and share previews", async () => {
    vi.mocked(listPublishedNotes).mockResolvedValue([notes[2]])
    vi.mocked(getPublishedNoteBySlug).mockResolvedValue(null)
    vi.mocked(getNotePublicationStatusBySlug).mockResolvedValue("unpublished")
    const home = render(await HomePage())
    expect(home.container.querySelector('a[href="/notes/ai-thoughts"]')).toBeNull()
    const props = { params: Promise.resolve({ slug: "ai-thoughts" }) }
    const page = render(await NotePage(props))
    expect(page.container).not.toHaveTextContent("Published body")
    const metadata = await generateMetadata(props)
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
    expect(metadata.openGraph).toBeUndefined()
  })
})
