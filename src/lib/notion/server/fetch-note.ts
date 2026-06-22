import { unstable_cache } from "next/cache"
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

export type NotePublicationStatus = "published" | "unpublished" | "missing"

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

function extractPublished(page: PageObjectResponse): boolean {
  const prop = page.properties[PUBLISHED_PROPERTY]
  if (prop?.type !== "checkbox") return false
  return prop.checkbox
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

async function _queryBySlugImpl(slugEquals: string): Promise<PageObjectResponse[]> {
  const notion = getNotionClient()
  if (!notion) return []
  const results: PageObjectResponse[] = []
  let cursor: string | undefined = undefined

  const filter: QueryFilter = {
    property: SLUG_PROPERTY,
    rich_text: { equals: slugEquals },
  }

  // Paginate defensively in case duplicated slugs exist.
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

const queryBySlug = unstable_cache(
  _queryBySlugImpl,
  ["notion-query-by-slug"],
  { tags: ["notes"] }
)

export async function listPublishedNotes(): Promise<NoteSummary[]> {
  const pages = await queryPublished()
  const out: NoteSummary[] = []
  for (const p of pages) {
    const s = toSummary(p)
    if (s) out.push(s)
  }
  return out
}

export async function getNotePublicationStatusBySlug(
  slug: string
): Promise<NotePublicationStatus> {
  const pages = await queryBySlug(slug)
  const page = pages[0]
  if (!page) return "missing"
  return extractPublished(page) ? "published" : "unpublished"
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
  if (!page) return null
  const summary = toSummary(page)
  if (!summary) return null
  const blocks = await listAllBlocks(page.id)
  return { ...summary, blocks }
}
