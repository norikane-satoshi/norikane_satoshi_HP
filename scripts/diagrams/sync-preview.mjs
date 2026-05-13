#!/usr/bin/env node
/**
 * sync-preview.mjs — render-preview.mjs が生成した <slug>.preview.png を
 * Notion 記事ページに「__preview__:<slug>」キャプション付き image block として
 * 冪等に同期する。
 *
 * 流れ (各 slug ごと):
 *   1. 対象ページの blocks を全 list
 *   2. 既存 image block で caption が `__preview__:<slug>` で始まるものを検索
 *      - 存在すれば → 既存 block を archive (delete) してから新しい block を挿入し直す
 *        (Notion file_upload は block の image.file を差し替える update API がない
 *         ため、新規 upload + 旧ブロック削除の付け替えで「同じ位置に最新 PNG」を
 *         実現する。重複追加は禁止のため archive→insert の順で行う)
 *      - 存在しない場合 → 新規 upload + insert (after = marker paragraph)
 *   3. 挿入後、再度 list して preview block 数を検証 (slug ごとに必ず 1 つ)
 *
 * 入力:
 *   --page-id <id>           対象 Notion ページ ID
 *   --slug <slug>            (繰り返し可) 同期対象 slug。指定なしなら全 slug。
 *   --dry-run                Notion 書き込みを行わず計画だけを stdout に出す
 *   --no-archive             既存 preview block があってもファイルだけ差し替え
 *                            たいケース用 (Notion API で image.file 差替えが提供
 *                            されていないため、--no-archive 時は同一 sha256 で
 *                            あれば skip / 異なれば archive→insert に格上げ)
 *
 * caption 仕様 (HP renderer 側 render-blocks.tsx の skip 判定キー):
 *   `__preview__:<slug>` (slug は ascii kebab-case)
 *
 * Notion API で image block を file_upload 経由で挿入するには:
 *   POST /v1/file_uploads { mode: "single_part", filename }
 *   POST <upload_url> multipart/form-data { file: <binary> }
 *   PATCH /v1/blocks/<page_id>/children { children: [image{file_upload}], after }
 */
import { readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..", "..")
const NOTION_VERSION = "2022-06-28"
const API_BASE = "https://api.notion.com/v1"

// page_id → { slugs: [...] } 不要 (sync は --page-id + --slug の組合せで動く)。
// ただし default で 3 ページ全部回したい運用も多いので、env で切替可能にしておく。
const ARTICLE_PAGES = {
  "15103996-61d6-4891-aee9-12320df39b91": {
    slug: "correction",
    diagrams: [
      "correction-factor-map",
      "correction-scope-map",
      "correction-exposure-bracket",
      "correction-control-math",
      "correction-reversibility-compare",
      "correction-space-choice",
    ],
  },
  "2d611945-73e1-4078-9602-864a9040affe": {
    slug: "grading",
    diagrams: ["grading-look-decomposition", "grading-words-to-knobs"],
  },
  "7202c1ee-64c0-4c97-a482-1b8e4f2e0f67": {
    slug: "filmlook",
    diagrams: ["filmlook-physics-flow", "filmlook-density-mixture"],
  },
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      "page-id": { type: "string" },
      slug: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
      "no-archive": { type: "boolean", default: false },
      "all-pages": { type: "boolean", default: false },
    },
  })
  if (!values["all-pages"] && !values["page-id"]) {
    throw new Error("either --page-id or --all-pages is required")
  }
  return {
    pageId: values["page-id"],
    slugs: values.slug ?? null,
    dryRun: values["dry-run"],
    noArchive: values["no-archive"],
    allPages: values["all-pages"],
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
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 600)}`)
  }
  return text ? JSON.parse(text) : {}
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
  const buf = await readFile(filePath)
  const blob = new Blob([buf], { type: "image/png" })
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

async function archiveBlock(blockId) {
  return notion(`/blocks/${blockId}`, { method: "DELETE" })
}

async function sha256OfFile(filePath) {
  const buf = await readFile(filePath)
  return createHash("sha256").update(buf).digest("hex")
}

function captionFor(slug) {
  return `__preview__:${slug}`
}

function markerFor(slug) {
  return `[[diagram:${slug}]]`
}

async function syncOneSlug({ pageId, slug, dryRun, noArchive, blocks }) {
  const filePath = resolve(REPO_ROOT, "public", "notes", "diagrams", `${slug}.preview.png`)
  if (!existsSync(filePath)) {
    return {
      ok: false,
      slug,
      page_id: pageId,
      reason: "preview-png-missing",
      expected_path: filePath.replace(`${REPO_ROOT}/`, ""),
    }
  }

  const marker = markerFor(slug)
  const caption = captionFor(slug)

  // marker paragraph (after = この段落の直後に preview を置く)
  const markerBlock = blocks.find(
    (b) => b.type === "paragraph" && paragraphPlain(b).trim() === marker,
  )
  if (!markerBlock) {
    return {
      ok: false,
      slug,
      page_id: pageId,
      reason: "marker-paragraph-not-found",
      marker,
    }
  }

  // 既存 preview image block (caption が __preview__:<slug>) を全部拾う
  const previewMatches = blocks.filter(
    (b) => b.type === "image" && imageCaptionPlain(b).startsWith(caption),
  )
  // 旧 caption 形式 "HP図解プレビュー: <slug>" も同義として拾い、上書き対象にする
  const legacyMatches = blocks.filter(
    (b) =>
      b.type === "image" &&
      imageCaptionPlain(b).startsWith(`HP図解プレビュー: ${slug}`),
  )
  const existing = [...previewMatches, ...legacyMatches]

  const sha = await sha256OfFile(filePath)

  if (dryRun) {
    return {
      ok: true,
      slug,
      page_id: pageId,
      dry_run: true,
      marker_block_id: markerBlock.id,
      existing_preview_block_ids: existing.map((b) => b.id),
      legacy_block_ids: legacyMatches.map((b) => b.id),
      png_sha256: sha,
      action:
        existing.length === 0
          ? "would-insert"
          : noArchive
            ? "would-skip-or-replace"
            : "would-replace",
    }
  }

  // archive 既存 preview。Notion API で image block の file 差し替えはできない
  // ため、preview を最新化したい場合は archive→insert の付け替えしかない。
  // --no-archive のとき: existing が 1 つだけかつ caption が完全一致なら no-op
  if (noArchive && existing.length === 1) {
    const cap = imageCaptionPlain(existing[0])
    if (cap === caption) {
      return {
        ok: true,
        slug,
        page_id: pageId,
        skipped: true,
        reason: "no-archive-and-caption-matches",
        existing_block_id: existing[0].id,
      }
    }
  }
  for (const b of existing) {
    await archiveBlock(b.id)
  }

  // 新規 upload + insert
  const upload = await createFileUpload(`${slug}.preview.png`)
  await sendFileUpload(upload.upload_url, filePath)

  const body = {
    children: [
      {
        object: "block",
        type: "image",
        image: {
          type: "file_upload",
          file_upload: { id: upload.id },
          caption: [{ type: "text", text: { content: caption } }],
        },
      },
    ],
    after: markerBlock.id,
  }
  const res = await notion(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  const inserted = res.results?.[0]
  return {
    ok: true,
    slug,
    page_id: pageId,
    archived_block_ids: existing.map((b) => b.id),
    file_upload_id: upload.id,
    inserted_block_id: inserted?.id,
    marker_block_id: markerBlock.id,
    caption,
    png_sha256: sha,
  }
}

async function syncOnePage({ pageId, slugs, dryRun, noArchive }) {
  const targetSlugs = slugs?.length ? slugs : ARTICLE_PAGES[pageId]?.diagrams
  if (!targetSlugs) {
    throw new Error(
      `no slug list for page-id ${pageId}; pass --slug explicitly or use a known article page`,
    )
  }
  // marker / preview block のスキャンは 1 回 list する。Sync 中に list を逐次
  // 取り直すと block index がずれて二重挿入リスクがあるため、初回 list の
  // marker/preview 構造に対して順次 patch を発行する。
  const initialBlocks = await listAllChildren(pageId)
  const results = []
  for (const slug of targetSlugs) {
    // archive→insert を直前 list ではなく初回 list 基準にしないため、
    // 各 slug ごとに最新の blocks を取り直す (preview block 番号がずれるため)
    const blocks = await listAllChildren(pageId)
    const r = await syncOneSlug({ pageId, slug, dryRun, noArchive, blocks })
    results.push(r)
  }
  // 冪等性検証: 再 list して preview 数 = slug 数を確認
  const verify = await listAllChildren(pageId)
  const previewCounts = {}
  for (const b of verify) {
    if (b.type !== "image") continue
    const cap = imageCaptionPlain(b)
    const m = /^__preview__:([a-z0-9-]+)$/.exec(cap)
    if (m) previewCounts[m[1]] = (previewCounts[m[1]] ?? 0) + 1
  }
  return {
    page_id: pageId,
    initial_block_count: initialBlocks.length,
    final_block_count: verify.length,
    preview_counts: previewCounts,
    results,
  }
}

async function main() {
  const { pageId, slugs, dryRun, noArchive, allPages } = parseCli()
  if (allPages) {
    const pages = Object.keys(ARTICLE_PAGES)
    const out = []
    for (const pid of pages) {
      const r = await syncOnePage({ pageId: pid, slugs, dryRun, noArchive })
      out.push(r)
    }
    process.stdout.write(JSON.stringify({ ok: true, pages: out }, null, 2) + "\n")
    return
  }
  const r = await syncOnePage({ pageId, slugs, dryRun, noArchive })
  process.stdout.write(JSON.stringify({ ok: true, ...r }, null, 2) + "\n")
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`)
  process.exit(1)
})
