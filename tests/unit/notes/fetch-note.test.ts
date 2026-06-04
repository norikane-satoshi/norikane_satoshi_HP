import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getNotionClient: vi.fn(),
  query: vi.fn(),
  listChildren: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}))

vi.mock("@/lib/notion/server/client", () => ({
  getNotionClient: mocks.getNotionClient,
  IB_NOTE_DATA_SOURCE_ID: "notes-db",
  PUBLISHED_PROPERTY: "Published",
  SLUG_PROPERTY: "Slug",
  TITLE_PROPERTY: "Name",
}))

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}))

import {
  getPublishedNoteBySlug,
  listPublishedNotes,
} from "@/lib/notion/server/fetch-note"

function page({
  id,
  slug,
  title,
}: {
  id: string
  slug?: string
  title?: string
}) {
  return {
    id,
    created_time: "2026-05-01T00:00:00.000Z",
    last_edited_time: "2026-05-02T00:00:00.000Z",
    properties: {
      Name: {
        type: "title",
        title: title === undefined ? [] : [{ plain_text: title }],
      },
      Slug:
        slug === undefined
          ? { type: "rich_text", rich_text: [] }
          : { type: "rich_text", rich_text: [{ plain_text: slug }] },
    },
  }
}

function paragraph(id: string, hasChildren = false) {
  return {
    id,
    type: "paragraph",
    has_children: hasChildren,
    paragraph: { rich_text: [] },
  }
}

describe("notion note fetching", () => {
  beforeEach(() => {
    mocks.getNotionClient.mockReset()
    mocks.query.mockReset()
    mocks.listChildren.mockReset()
    mocks.readFile.mockReset()
    mocks.readFile.mockRejectedValue(new Error("missing fixture"))
  })

  it("returns empty/null results when the Notion client is unavailable", async () => {
    mocks.getNotionClient.mockReturnValue(null)

    await expect(listPublishedNotes()).resolves.toEqual([])
    await expect(getPublishedNoteBySlug("missing")).resolves.toBeNull()
  })

  it("lists published notes, paginates, and skips rows without full summaries", async () => {
    mocks.getNotionClient.mockReturnValue({
      dataSources: { query: mocks.query },
      blocks: { children: { list: mocks.listChildren } },
    })
    mocks.query
      .mockResolvedValueOnce({
        results: [
          page({ id: "p1", slug: "first", title: "First" }),
          { id: "partial" },
        ],
        has_more: true,
        next_cursor: "next",
      })
      .mockResolvedValueOnce({
        results: [
          page({ id: "p2", slug: "", title: "No slug" }),
          page({ id: "p3", slug: "third", title: "Third" }),
        ],
        has_more: false,
        next_cursor: null,
      })

    await expect(listPublishedNotes()).resolves.toEqual([
      {
        id: "p1",
        slug: "first",
        title: "First",
        createdTime: "2026-05-01T00:00:00.000Z",
        lastEditedTime: "2026-05-02T00:00:00.000Z",
      },
      {
        id: "p3",
        slug: "third",
        title: "Third",
        createdTime: "2026-05-01T00:00:00.000Z",
        lastEditedTime: "2026-05-02T00:00:00.000Z",
      },
    ])
    expect(mocks.query.mock.calls[0]?.[0]).toMatchObject({
      data_source_id: "notes-db",
      page_size: 100,
    })
    expect(mocks.query.mock.calls[1]?.[0]).toMatchObject({
      start_cursor: "next",
    })
  })

  it("fetches one published note by slug with recursive block children", async () => {
    mocks.getNotionClient.mockReturnValue({
      dataSources: { query: mocks.query },
      blocks: { children: { list: mocks.listChildren } },
    })
    mocks.query.mockResolvedValueOnce({
      results: [page({ id: "note-1", slug: "target", title: "Target" })],
      has_more: false,
      next_cursor: null,
    })
    mocks.listChildren.mockImplementation(
      async ({ block_id, start_cursor }: { block_id: string; start_cursor?: string }) => {
        if (block_id === "note-1" && !start_cursor) {
          return {
            results: [paragraph("parent", true), { id: "partial" }],
            has_more: true,
            next_cursor: "more-root",
          }
        }
        if (block_id === "parent") {
          return {
            results: [paragraph("child")],
            has_more: false,
            next_cursor: null,
          }
        }
        return {
          results: [paragraph("sibling")],
          has_more: false,
          next_cursor: null,
        }
      }
    )

    await expect(getPublishedNoteBySlug("target")).resolves.toMatchObject({
      id: "note-1",
      slug: "target",
      title: "Target",
      blocks: [
        { id: "parent", children: [{ id: "child" }] },
        { id: "sibling" },
      ],
    })
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          and: [
            { property: "Published", checkbox: { equals: true } },
            { property: "Slug", rich_text: { equals: "target" } },
          ],
        },
      })
    )
  })

  it("returns null when no page or no usable summary is found", async () => {
    mocks.getNotionClient.mockReturnValue({
      dataSources: { query: mocks.query },
      blocks: { children: { list: mocks.listChildren } },
    })
    mocks.query
      .mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null })
      .mockResolvedValueOnce({
        results: [page({ id: "bad", slug: "slug-only" })],
        has_more: false,
        next_cursor: null,
      })

    await expect(getPublishedNoteBySlug("missing")).resolves.toBeNull()
    await expect(getPublishedNoteBySlug("bad")).resolves.toBeNull()
  })

  it("falls back to local public article markdown for canonical note slugs", async () => {
    mocks.getNotionClient.mockReturnValue({
      dataSources: { query: mocks.query },
      blocks: { children: { list: mocks.listChildren } },
    })
    mocks.query.mockImplementation(async (request: { filter?: { and?: unknown[] } }) => {
      const serializedFilter = JSON.stringify(request.filter)
      if (serializedFilter.includes('"equals":"grading"')) {
        return { results: [], has_more: false, next_cursor: null }
      }
      return {
        results: [page({ id: "note-1", slug: "correction", title: "Notion correction" })],
        has_more: false,
        next_cursor: null,
      }
    })
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("article-correction.md")) {
        return "# Local correction\n\nCorrection body"
      }
      if (path.endsWith("article-grading.md")) {
        return "# Local grading\n\n## Heading\n\nBody with **bold** and [link](https://example.com)."
      }
      if (path.endsWith("article-filmlook.md")) {
        return "# Local filmlook\n\nFilmlook body"
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    await expect(listPublishedNotes()).resolves.toMatchObject([
      { slug: "correction", title: "Notion correction" },
      { slug: "grading", title: "Local grading" },
      { slug: "filmlook", title: "Local filmlook" },
    ])

    await expect(getPublishedNoteBySlug("grading")).resolves.toMatchObject({
      slug: "grading",
      title: "Local grading",
      blocks: [
        { type: "heading_1" },
        { type: "paragraph" },
      ],
    })
  })
})
