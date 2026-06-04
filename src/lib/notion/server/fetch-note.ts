import { unstable_cache } from "next/cache"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  getNotionClient,
  IB_NOTE_DATA_SOURCE_ID,
  PUBLISHED_PROPERTY,
  SLUG_PROPERTY,
  TITLE_PROPERTY,
} from "./client"

import type {
  BlockObjectResponse,
  PageObjectResponse,
  PartialBlockObjectResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
  RichTextItemResponse,
} from "@notionhq/client"
import type { BlockWithChildren } from "./types"

export type NoteSummary = {
  id: string
  slug: string
  title: string
  createdTime: string
  lastEditedTime: string
}

export type NoteFull = NoteSummary & {
  blocks: BlockWithChildren[]
}

function isFullPage(
  row: QueryDataSourceResponse["results"][number]
): row is PageObjectResponse {
  return "properties" in row
}

function extractTitle(page: PageObjectResponse): string {
  const prop = page.properties[TITLE_PROPERTY]
  if (prop?.type !== "title") return ""
  return prop.title.map((t) => t.plain_text).join("").trim()
}

function extractSlug(page: PageObjectResponse): string {
  const prop = page.properties[SLUG_PROPERTY]
  if (!prop) return ""
  if (prop.type === "rich_text") {
    return prop.rich_text.map((t) => t.plain_text).join("").trim()
  }
  if (prop.type === "title") {
    return prop.title.map((t) => t.plain_text).join("").trim()
  }
  return ""
}

function toSummary(page: PageObjectResponse): NoteSummary | null {
  const slug = extractSlug(page)
  const title = extractTitle(page)
  if (!slug || !title) return null
  return {
    id: page.id,
    slug,
    title,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
  }
}

type QueryFilter = QueryDataSourceParameters["filter"]

const FALLBACK_NOTES = [
  { slug: "correction", file: "article-correction.md" },
  { slug: "grading", file: "article-grading.md" },
  { slug: "filmlook", file: "article-filmlook.md" },
] as const

type FallbackNoteSlug = (typeof FALLBACK_NOTES)[number]["slug"]

function fallbackMeta(slug: FallbackNoteSlug) {
  return FALLBACK_NOTES.find((note) => note.slug === slug)
}

function fallbackSummary(
  slug: FallbackNoteSlug,
  title: string
): NoteSummary {
  return {
    id: `fallback-${slug}`,
    slug,
    title,
    createdTime: "2026-04-24T00:00:00.000Z",
    lastEditedTime: "2026-04-24T00:00:00.000Z",
  }
}

async function readFallbackMarkdown(
  slug: FallbackNoteSlug
): Promise<string | null> {
  const meta = fallbackMeta(slug)
  if (!meta) return null
  try {
    return await readFile(join(process.cwd(), meta.file), "utf8")
  } catch {
    return null
  }
}

function fallbackTitle(markdown: string) {
  const heading = markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith("# "))
  return heading?.replace(/^#\s+/, "").trim() ?? ""
}

function baseAnnotations(overrides?: Partial<RichTextItemResponse["annotations"]>) {
  return {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default" as const,
    ...overrides,
  }
}

function richText(
  text: string,
  options?: {
    href?: string | null
    annotations?: Partial<RichTextItemResponse["annotations"]>
  }
): RichTextItemResponse {
  return {
    type: "text",
    text: { content: text, link: options?.href ? { url: options.href } : null },
    annotations: baseAnnotations(options?.annotations),
    plain_text: text,
    href: options?.href ?? null,
  } as RichTextItemResponse
}

function parseInlineMarkdown(text: string): RichTextItemResponse[] {
  const parts: RichTextItemResponse[] = []
  const pattern = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`)/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) {
      parts.push(richText(text.slice(cursor, match.index)))
    }
    if (match[2]) {
      parts.push(richText(match[2], { annotations: { bold: true } }))
    } else if (match[3] && match[4]) {
      parts.push(richText(match[3], { href: match[4] }))
    } else if (match[5]) {
      parts.push(richText(match[5], { annotations: { code: true } }))
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) {
    parts.push(richText(text.slice(cursor)))
  }
  return parts
}

function fallbackBlock(
  id: string,
  type: "heading_1" | "heading_2" | "heading_3" | "paragraph" | "divider",
  text = ""
): BlockWithChildren {
  if (type === "divider") {
    return { id, type: "divider", has_children: false, divider: {} } as BlockWithChildren
  }
  const rich_text = parseInlineMarkdown(text)
  if (type === "heading_1") {
    return {
      id,
      type,
      has_children: false,
      heading_1: { rich_text, is_toggleable: false, color: "default" },
    } as BlockWithChildren
  }
  if (type === "heading_2") {
    return {
      id,
      type,
      has_children: false,
      heading_2: { rich_text, is_toggleable: false, color: "default" },
    } as BlockWithChildren
  }
  if (type === "heading_3") {
    return {
      id,
      type,
      has_children: false,
      heading_3: { rich_text, is_toggleable: false, color: "default" },
    } as BlockWithChildren
  }
  return {
    id,
    type,
    has_children: false,
    paragraph: { rich_text, color: "default" },
  } as BlockWithChildren
}

function markdownToBlocks(markdown: string, slug: string): BlockWithChildren[] {
  const blocks: BlockWithChildren[] = []
  const paragraphLines: string[] = []
  let blockIndex = 0

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    const text = paragraphLines.join(" ").trim()
    paragraphLines.length = 0
    if (!text) return
    blocks.push(fallbackBlock(`${slug}-p-${blockIndex++}`, "paragraph", text))
  }

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }
    if (line === "---") {
      flushParagraph()
      blocks.push(fallbackBlock(`${slug}-d-${blockIndex++}`, "divider"))
      continue
    }
    if (line.startsWith("# ")) {
      flushParagraph()
      continue
    }
    if (line.startsWith("#### ")) {
      flushParagraph()
      blocks.push(fallbackBlock(`${slug}-h3-${blockIndex++}`, "heading_3", line.slice(5)))
      continue
    }
    if (line.startsWith("### ")) {
      flushParagraph()
      blocks.push(fallbackBlock(`${slug}-h2-${blockIndex++}`, "heading_2", line.slice(4)))
      continue
    }
    if (line.startsWith("## ")) {
      flushParagraph()
      blocks.push(fallbackBlock(`${slug}-h1-${blockIndex++}`, "heading_1", line.slice(3)))
      continue
    }
    paragraphLines.push(line)
  }

  flushParagraph()
  return blocks
}

async function getFallbackNoteBySlug(
  slug: string
): Promise<NoteFull | null> {
  const meta = fallbackMeta(slug as FallbackNoteSlug)
  if (!meta) return null
  const markdown = await readFallbackMarkdown(meta.slug)
  if (!markdown) return null
  const title = fallbackTitle(markdown)
  if (!title) return null
  return {
    ...fallbackSummary(meta.slug, title),
    blocks: markdownToBlocks(markdown, meta.slug),
  }
}

async function listFallbackNotes(): Promise<NoteSummary[]> {
  const summaries: NoteSummary[] = []
  for (const meta of FALLBACK_NOTES) {
    const markdown = await readFallbackMarkdown(meta.slug)
    if (!markdown) continue
    const title = fallbackTitle(markdown)
    if (title) summaries.push(fallbackSummary(meta.slug, title))
  }
  return summaries
}

async function _queryPublishedImpl(
  slugEquals?: string
): Promise<PageObjectResponse[]> {
  const notion = getNotionClient()
  if (!notion) return []
  const results: PageObjectResponse[] = []
  let cursor: string | undefined = undefined

  const filter: QueryFilter = slugEquals
    ? {
        and: [
          { property: PUBLISHED_PROPERTY, checkbox: { equals: true } },
          { property: SLUG_PROPERTY, rich_text: { equals: slugEquals } },
        ],
      }
    : {
        and: [
          { property: PUBLISHED_PROPERTY, checkbox: { equals: true } },
          { property: SLUG_PROPERTY, rich_text: { is_not_empty: true } },
        ],
      }

  // Paginate defensively.
  for (let i = 0; i < 10; i += 1) {
    const resp: QueryDataSourceResponse = await notion.dataSources.query({
      data_source_id: IB_NOTE_DATA_SOURCE_ID,
      filter,
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
      page_size: 100,
      start_cursor: cursor,
    })
    for (const row of resp.results) {
      if (isFullPage(row)) results.push(row)
    }
    if (!resp.has_more || !resp.next_cursor) break
    cursor = resp.next_cursor
  }

  return results
}

const queryPublished = unstable_cache(
  _queryPublishedImpl,
  ["notion-query-published"],
  { tags: ["notes"] }
)

export async function listPublishedNotes(): Promise<NoteSummary[]> {
  const pages = await queryPublished()
  const out: NoteSummary[] = []
  for (const p of pages) {
    const s = toSummary(p)
    if (s) out.push(s)
  }
  const existingSlugs = new Set(out.map((note) => note.slug))
  for (const fallback of await listFallbackNotes()) {
    if (!existingSlugs.has(fallback.slug)) {
      out.push(fallback)
    }
  }
  return out
}

function isFullBlock(
  b: BlockObjectResponse | PartialBlockObjectResponse
): b is BlockObjectResponse {
  return "type" in b
}

const MAX_BLOCK_DEPTH = 4

async function listBlockChildren(
  blockId: string,
  depth: number
): Promise<BlockWithChildren[]> {
  const notion = getNotionClient()
  if (!notion) return []
  const out: BlockWithChildren[] = []
  let cursor: string | undefined = undefined
  for (let i = 0; i < 50; i += 1) {
    const resp = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    })
    for (const b of resp.results) {
      if (!isFullBlock(b)) continue
      if (b.has_children && depth < MAX_BLOCK_DEPTH) {
        out.push({
          ...b,
          children: await listBlockChildren(b.id, depth + 1),
        })
        continue
      }
      out.push(b)
    }
    if (!resp.has_more || !resp.next_cursor) break
    cursor = resp.next_cursor
  }
  return out
}

async function _listAllBlocksImpl(
  pageId: string
): Promise<BlockWithChildren[]> {
  return listBlockChildren(pageId, 0)
}

const listAllBlocks = unstable_cache(
  _listAllBlocksImpl,
  ["notion-list-all-blocks"],
  { tags: ["notes"] }
)

export async function getPublishedNoteBySlug(
  slug: string
): Promise<NoteFull | null> {
  const pages = await queryPublished(slug)
  const page = pages[0]
  if (!page) return getFallbackNoteBySlug(slug)
  const summary = toSummary(page)
  if (!summary) return getFallbackNoteBySlug(slug)
  const blocks = await listAllBlocks(page.id)
  return { ...summary, blocks }
}
