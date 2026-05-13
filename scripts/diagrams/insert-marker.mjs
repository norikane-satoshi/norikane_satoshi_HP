#!/usr/bin/env node
/**
 * insert-marker.mjs — Notion ページに [[diagram:<slug>]] paragraph を冪等に挿入する。
 *
 * 挿入位置は次の二択 (--after-heading と --after-marker-slug は排他、どちらか必須):
 *   --after-heading "<text>"        指定見出し直後 (heading_1/2/3 のいずれか、トリミング一致)
 *   --after-marker-slug <slug>      同ページ内の既存 [[diagram:<slug>]] 段落の直後
 *
 * 使い方:
 *   node scripts/diagrams/insert-marker.mjs \
 *     --page-id <notion-page-id> \
 *     --slug <diagram-slug> \
 *     --after-heading "<heading plain text>"
 *
 *   node scripts/diagrams/insert-marker.mjs \
 *     --page-id <notion-page-id> \
 *     --slug <diagram-slug> \
 *     --after-marker-slug <existing-diagram-slug>
 *
 * 認証: NOTION_API_KEY (Bearer)
 *
 * 既に同一 slug の marker paragraph がページ内に存在する場合は no-op。
 */
import { parseArgs } from "node:util"

const NOTION_VERSION = "2022-06-28"
const API_BASE = "https://api.notion.com/v1"

function parseCli() {
  const { values } = parseArgs({
    options: {
      "page-id": { type: "string" },
      slug: { type: "string" },
      "after-heading": { type: "string" },
      "after-marker-slug": { type: "string" },
    },
  })
  if (!values["page-id"] || !values.slug) {
    throw new Error("--page-id and --slug are required")
  }
  const ah = values["after-heading"]
  const ams = values["after-marker-slug"]
  if (!ah && !ams) {
    throw new Error(
      "either --after-heading or --after-marker-slug must be specified",
    )
  }
  if (ah && ams) {
    throw new Error(
      "--after-heading and --after-marker-slug are mutually exclusive",
    )
  }
  return {
    pageId: values["page-id"],
    slug: values.slug,
    afterHeading: ah,
    afterMarkerSlug: ams,
  }
}

function getToken() {
  const t = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN
  if (!t) throw new Error("NOTION_API_KEY (or NOTION_TOKEN) is not set")
  return t
}

async function notion(path, init = {}) {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 500)}`)
  }
  return JSON.parse(text)
}

async function listAllChildren(blockId) {
  const out = []
  let cursor
  do {
    const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : ""
    const j = await notion(`/blocks/${blockId}/children${qs}`)
    out.push(...j.results)
    cursor = j.has_more ? j.next_cursor : null
  } while (cursor)
  return out
}

function plainOf(rich) {
  return (rich || []).map((r) => r.plain_text).join("")
}

function isHeading(b) {
  return (
    b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3"
  )
}

function headingText(b) {
  if (b.type === "heading_1") return plainOf(b.heading_1.rich_text)
  if (b.type === "heading_2") return plainOf(b.heading_2.rich_text)
  if (b.type === "heading_3") return plainOf(b.heading_3.rich_text)
  return ""
}

function paragraphText(b) {
  if (b.type !== "paragraph") return ""
  return plainOf(b.paragraph.rich_text)
}

function markerOf(slug) {
  return `[[diagram:${slug}]]`
}

async function main() {
  const { pageId, slug, afterHeading, afterMarkerSlug } = parseCli()
  const marker = markerOf(slug)

  const blocks = await listAllChildren(pageId)

  const existing = blocks.find(
    (b) => b.type === "paragraph" && paragraphText(b).trim() === marker,
  )
  if (existing) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "already-present",
          slug,
          page_id: pageId,
          marker,
          existing_block_id: existing.id,
        },
        null,
        2,
      ) + "\n",
    )
    return
  }

  let afterBlock
  let afterDescriptor
  if (afterHeading) {
    const target = afterHeading.trim()
    const heading = blocks.find(
      (b) => isHeading(b) && headingText(b).trim() === target,
    )
    if (!heading) {
      const headings = blocks
        .filter(isHeading)
        .map((b) => `[${b.type}] ${headingText(b)}`)
      throw new Error(
        `heading not found: "${afterHeading}". available headings:\n` +
          headings.join("\n"),
      )
    }
    afterBlock = heading
    afterDescriptor = { kind: "heading", id: heading.id, type: heading.type, text: target }
  } else {
    const targetMarker = markerOf(afterMarkerSlug)
    const m = blocks.find(
      (b) => b.type === "paragraph" && paragraphText(b).trim() === targetMarker,
    )
    if (!m) {
      const markers = blocks
        .filter((b) => b.type === "paragraph")
        .map((b) => paragraphText(b).trim())
        .filter((t) => /^\[\[diagram:[a-z0-9_-]+\]\]$/i.test(t))
      throw new Error(
        `marker not found: "${targetMarker}". available markers in page:\n` +
          (markers.length ? markers.join("\n") : "(none)"),
      )
    }
    afterBlock = m
    afterDescriptor = { kind: "marker", id: m.id, slug: afterMarkerSlug, marker: targetMarker }
  }

  const body = {
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: marker },
            },
          ],
        },
      },
    ],
    after: afterBlock.id,
  }
  const res = await notion(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  const inserted = res.results?.[0]
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        inserted: true,
        slug,
        page_id: pageId,
        marker,
        after: afterDescriptor,
        inserted_block_id: inserted?.id,
      },
      null,
      2,
    ) + "\n",
  )
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`)
  process.exit(1)
})
