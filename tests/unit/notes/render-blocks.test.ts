import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", async () => {
  const React = await import("react")
  return {
    default: ({
      href,
      className,
      children,
    }: {
      href: string
      className?: string
      children: ReactNode
    }) => React.createElement("a", { href, className }, children),
  }
})

vi.mock("react-tweet", async () => {
  const React = await import("react")
  return {
    Tweet: ({ id }: { id: string }) =>
      React.createElement("div", { "data-tweet": id }, `tweet:${id}`),
  }
})

vi.mock("@/components/notes/note-diagram", async () => {
  const React = await import("react")
  return {
    NoteDiagram: ({ config }: { config: { slug: string } }) =>
      React.createElement(
        "figure",
        { "data-note-diagram": config.slug },
        `diagram:${config.slug}`
      ),
  }
})

vi.mock("@/components/notes/note-visual", async () => {
  const React = await import("react")
  return {
    NoteVisual: ({ slug }: { slug: string }) =>
      React.createElement(
        "figure",
        { "data-note-visual": slug },
        `visual:${slug}`
      ),
  }
})

import { buildSlugIndex, RenderBlocks } from "@/lib/notion/server/render-blocks"
import type { BlockWithChildren } from "@/lib/notion/server/types"

function rich(
  plainText: string,
  options: {
    href?: string | null
    mentionPageId?: string
    bold?: boolean
    italic?: boolean
    code?: boolean
  } = {}
) {
  return {
    type: options.mentionPageId ? "mention" : "text",
    mention: options.mentionPageId
      ? { type: "page", page: { id: options.mentionPageId } }
      : undefined,
    text: options.mentionPageId ? undefined : { content: plainText },
    plain_text: plainText,
    href: options.href ?? null,
    annotations: {
      bold: options.bold ?? false,
      italic: options.italic ?? false,
      code: options.code ?? false,
      strikethrough: false,
      underline: false,
      color: "default",
    },
  }
}

function block(type: string, body: Record<string, unknown> = {}) {
  return {
    id: `${type}-0000-0000-0000-000000000000`,
    type,
    has_children: false,
    archived: false,
    in_trash: false,
    created_time: "2026-05-13T00:00:00.000Z",
    last_edited_time: "2026-05-13T00:00:00.000Z",
    [type]: body,
  } as unknown as BlockWithChildren
}

describe("notion render blocks", () => {
  it("builds slug indexes and renders PR #49 visual/diagram/embed branches", () => {
    const slugIndex = buildSlugIndex([
      {
        id: "11111111-2222-3333-4444-555555555555",
        slug: "target-note",
      },
    ])

    const blocks: BlockWithChildren[] = [
      block("heading_1", { rich_text: [rich("Heading 1")] }),
      block("heading_2", { rich_text: [rich("Heading 2")] }),
      block("heading_3", { rich_text: [rich("Heading 3")] }),
      block("paragraph", { rich_text: [] }),
      block("paragraph", {
        rich_text: [
          rich("[[diagram:correction-labyrinth-to-factor]]"),
        ],
      }),
      block("paragraph", {
        rich_text: [rich("[[diagram:grading-words-to-knobs]]")],
      }),
      block("paragraph", {
        rich_text: [rich("[[diagram:correction-factor-map]]")],
      }),
      block("paragraph", {
        rich_text: [rich("[[diagram:unknown-marker]]")],
      }),
      block("paragraph", {
        rich_text: [
          rich("internal", { href: "/notes/local", bold: true }),
          rich(" external", { href: "https://example.com", italic: true }),
          rich(" code", { code: true }),
          rich(" mention", {
            mentionPageId: "11111111222233334444555555555555",
          }),
          rich(" orphan", {
            mentionPageId: "99999999-2222-3333-4444-555555555555",
          }),
        ],
      }),
      block("divider"),
      block("image", { type: "external", external: { url: "https://img" } }),
      {
        ...block("column_list"),
        children: [
          {
            ...block("column", { width_ratio: 0.25 }),
            children: [
              block("quote", {
                rich_text: [rich("quote")],
              }),
            ],
          },
          {
            ...block("column", { width_ratio: 0.75 }),
            children: [block("paragraph", { rich_text: [rich("col")] })],
          },
        ],
      } as BlockWithChildren,
      block("embed", { url: "https://x.com/user/status/42" }),
      block("video", {
        type: "external",
        external: { url: "https://youtu.be/video-id" },
      }),
      block("video", {
        type: "file",
        file: { url: "https://cdn.example.com/video.mp4" },
      }),
      {
        ...block("bookmark"),
        bookmark: { nested: { href: "https://gist.github.com/u/g" } },
      } as unknown as BlockWithChildren,
      block("unsupported"),
    ]

    const html = renderToStaticMarkup(
      createElement(RenderBlocks, { blocks, slugIndex })
    )

    expect(html).toContain("visual:correction-labyrinth-to-factor")
    expect(html).toContain("visual:grading-secret-pantry")
    expect(html).toContain("diagram:correction-factor-map")
    expect(html).toContain("[[diagram:unknown-marker]]")
    expect(html).toContain('href="/notes/local"')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('href="/notes/target-note"')
    expect(html).toContain("orphan")
    expect(html).toContain("tweet:42")
    expect(html).toContain("https://www.youtube.com/embed/video-id")
    expect(html).toContain("https://cdn.example.com/video.mp4")
    expect(html).toContain("https://gist.github.com/u/g.pibb")
  })
})
