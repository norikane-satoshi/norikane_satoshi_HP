#!/usr/bin/env node
/**
 * insert-preview.mjs — Notion 下書きノート (記事本体) の HP用 marker paragraph
 * `[[diagram:<slug>]]` の直後に、Notion 上で直接見えるプレビュー image block を
 * 1 つだけ挿入する (重複禁止)。
 *
 * 流れ:
 *   1. Notion file_upload API で <slug>.webp をアップロード (single_part)
 *      POST /v1/file_uploads (mode=single_part) → { id, upload_url }
 *      POST upload_url with multipart/form-data { file: <binary> } → uploaded
 *   2. 対象ページの blocks を全 list、`[[diagram:<slug>]]` paragraph を見つける
 *   3. caption が "HP図解プレビュー: <slug>" で始まる image block が同ページに
 *      既存なら no-op (重複防止)
 *   4. なければ marker paragraph の after に image block 1 件を挿入
 *
 * 使い方:
 *   node scripts/diagrams/insert-preview.mjs --page-id <id> --slug <slug>
 *
 * caption は HP renderer 側 (render-blocks.tsx) の image-skip ガードと整合する
 * 文字列接頭辞 "HP図解プレビュー:" を持つ。HP 側ではこの caption を持つ image
 * block は明示的に skip される (caption に依らず image block 全 skip だが、
 * 将来 image 全般を表示する分岐が入った場合のガードを兼ねる)。
 */
import { readFileSync, statSync } from "node:fs"
import { resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { DIAGRAM_GEN_CONFIGS } from "./configs.mjs"

const NOTION_VERSION = "2022-06-28"
const API_BASE = "https://api.notion.com/v1"
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..", "..")

const SPEC_TITLES = {
  "correction-factor-map": "図解仕様書｜カラーコレクションの因数分解マップ",
  "grading-look-decomposition": "図解仕様書｜Look Decomposition 4軸マップ",
  "filmlook-physics-flow": "図解仕様書｜フィルムルックを作る物理の流れ",
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      "page-id": { type: "string" },
      slug: { type: "string" },
    },
  })
  if (!values["page-id"] || !values.slug) {
    throw new Error("--page-id, --slug are required")
  }
  return { pageId: values["page-id"], slug: values.slug }
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
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 600)}`)
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

function paragraphPlain(b) {
  if (b.type !== "paragraph") return ""
  return plainOf(b.paragraph.rich_text)
}

function imageCaptionPlain(b) {
  if (b.type !== "image") return ""
  return plainOf(b.image?.caption ?? [])
}

async function createFileUpload(filename) {
  return notion("/file_uploads", {
    method: "POST",
    body: JSON.stringify({ mode: "single_part", filename }),
  })
}

async function sendFileUpload(uploadUrl, filePath) {
  const token = getToken()
  const buf = readFileSync(filePath)
  const blob = new Blob([buf], { type: "image/webp" })
  const fd = new FormData()
  fd.append("file", blob, basename(filePath))
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} send: ${text.slice(0, 600)}`)
  }
  return JSON.parse(text)
}

async function main() {
  const { pageId, slug } = parseCli()
  if (!DIAGRAM_GEN_CONFIGS[slug]) {
    throw new Error(`unknown slug: ${slug}`)
  }
  const specTitle = SPEC_TITLES[slug] || slug
  const captionStr = `HP図解プレビュー: ${slug} (対応仕様書: ${specTitle})`
  const markerStr = `[[diagram:${slug}]]`
  const imgPath = resolve(REPO_ROOT, "public", "notes", "diagrams", `${slug}.webp`)
  statSync(imgPath) // throw if missing

  const blocks = await listAllChildren(pageId)

  // 既存 image block (caption が "HP図解プレビュー: <slug>" で始まる) があれば no-op
  const existingImage = blocks.find(
    (b) => b.type === "image" && imageCaptionPlain(b).startsWith(`HP図解プレビュー: ${slug}`),
  )
  if (existingImage) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: "preview-image-already-present",
        slug,
        page_id: pageId,
        existing_block_id: existingImage.id,
        caption: imageCaptionPlain(existingImage),
      }, null, 2) + "\n",
    )
    return
  }

  // marker paragraph を探す
  const marker = blocks.find(
    (b) => b.type === "paragraph" && paragraphPlain(b).trim() === markerStr,
  )
  if (!marker) {
    throw new Error(`marker paragraph not found: ${markerStr}`)
  }

  // file_upload (single_part)
  const upload = await createFileUpload(`${slug}.webp`)
  await sendFileUpload(upload.upload_url, imgPath)

  // image block 挿入 (after = marker paragraph)
  const body = {
    children: [
      {
        object: "block",
        type: "image",
        image: {
          type: "file_upload",
          file_upload: { id: upload.id },
          caption: [
            { type: "text", text: { content: captionStr } },
          ],
        },
      },
    ],
    after: marker.id,
  }
  const res = await notion(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  const inserted = res.results?.[0]
  process.stdout.write(
    JSON.stringify({
      ok: true,
      inserted: true,
      slug,
      page_id: pageId,
      file_upload_id: upload.id,
      marker_block_id: marker.id,
      inserted_block_id: inserted?.id,
      caption: captionStr,
    }, null, 2) + "\n",
  )
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`)
  process.exit(1)
})
