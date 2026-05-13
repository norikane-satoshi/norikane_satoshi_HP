#!/usr/bin/env node
/**
 * generate.mjs — Notion 本文 [[diagram:<slug>]] marker に対応する
 * 横長図解 (背景のみ・文字なし) を gpt-image-2 で生成する。
 *
 * 使い方:
 *   node scripts/diagrams/generate.mjs --slug correction-factor-map [--dry-run]
 *
 * 出力:
 *   public/notes/diagrams/<slug>.webp
 *   public/notes/diagrams/<slug>.meta.json
 *
 * 認証経路は X-post-pipeline (lib/image-generator/concept-image-generate.mjs) と
 * 同じ。OPENAI_API_KEY を環境から読み、Bearer で v1/images/generations を叩く。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import sharp from "sharp"
import { getDiagramGenConfig, DIAGRAM_GEN_CONFIGS } from "./configs.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..", "..")
const OUT_DIR = resolve(REPO_ROOT, "public", "notes", "diagrams")
const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/generations"
const OPENAI_MODEL = "gpt-image-2"

function parseCli() {
  const { values } = parseArgs({
    options: {
      slug: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  if (!values.slug) {
    const known = Object.keys(DIAGRAM_GEN_CONFIGS).join(", ")
    throw new Error(`--slug is required (known: ${known})`)
  }
  return { slug: values.slug, dryRun: values["dry-run"] }
}

function ensureOutDir() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
}

function summarizeRefs(refs) {
  return refs
    .map((rel) => {
      const abs = resolve(REPO_ROOT, rel)
      if (!existsSync(abs)) return { path: rel, exists: false }
      const st = statSync(abs)
      return { path: rel, exists: true, bytes: st.size }
    })
}

function summarizeUsedRefs(used) {
  return summarizeRefs(used || [])
}

function summarizeCheckedRefs(checked) {
  return (checked || []).map((entry) => {
    const abs = resolve(REPO_ROOT, entry.path)
    return {
      path: entry.path,
      exists: existsSync(abs),
      reason: entry.reason,
    }
  })
}

async function callOpenAI({ prompt, size, quality, output_format }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
  const body = {
    model: OPENAI_MODEL,
    prompt,
    n: 1,
    size,
    output_format,
  }
  if (quality) body.quality = quality
  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 300)}`)
  }
  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error(`response missing data[0].b64_json: ${text.slice(0, 300)}`)
  return Buffer.from(b64, "base64")
}

async function ensureWebp(buf, requestedFormat) {
  // OpenAI が webp を返さなかった/png でフォールバックした場合に sharp で webp に統一。
  // PNG/JPEG/WebP どれが渡ってきても WebP にエンコードし直して保存する。
  return sharp(buf).webp({ quality: 88 }).toBuffer()
}

async function main() {
  const { slug, dryRun } = parseCli()
  const cfg = getDiagramGenConfig(slug)
  const usedRefs = summarizeUsedRefs(cfg.referenceAssets?.used)
  const checkedRefs = summarizeCheckedRefs(cfg.referenceAssets?.checkedButNotUsed)

  ensureOutDir()
  const imgPath = join(OUT_DIR, `${slug}.webp`)
  const metaPath = join(OUT_DIR, `${slug}.meta.json`)

  if (dryRun) {
    process.stdout.write(JSON.stringify({ ok: true, dryRun: true, slug, used_refs: usedRefs, checked_refs: checkedRefs, prompt_preview: cfg.prompt.slice(0, 240) + "..." }, null, 2) + "\n")
    return
  }

  const startedAt = new Date()
  let pngOrWebp
  try {
    pngOrWebp = await callOpenAI({
      prompt: cfg.prompt,
      size: cfg.size,
      quality: cfg.quality,
      output_format: cfg.output_format,
    })
  } catch (primaryErr) {
    // output_format=webp が未対応のときは png で再試行
    if (/output_format|format/i.test(primaryErr.message) && cfg.output_format !== "png") {
      pngOrWebp = await callOpenAI({
        prompt: cfg.prompt,
        size: cfg.size,
        quality: cfg.quality,
        output_format: "png",
      })
    } else {
      throw primaryErr
    }
  }

  const webp = await ensureWebp(pngOrWebp, cfg.output_format)
  writeFileSync(imgPath, webp)

  const meta = {
    slug,
    title: slug,
    model: OPENAI_MODEL,
    endpoint: OPENAI_ENDPOINT,
    auth: "OPENAI_API_KEY (Bearer) — same path as x-post-pipeline lib/image-generator/concept-image-generate.mjs",
    size: cfg.size,
    quality: cfg.quality ?? null,
    output_format: cfg.output_format,
    output_format_actual: "webp",
    prompt: cfg.prompt,
    source_spec_notion_url: cfg.sourceSpecNotionUrl,
    target_article_notion_url: cfg.targetArticleNotionUrl,
    source_spec_summary: cfg.sourceSpecSummary,
    overlay_labels: cfg.overlayLabels,
    success_criteria: cfg.successCriteria,
    local_research_assets_used: usedRefs,
    local_research_assets_checked_but_not_used: checkedRefs,
    generation_rationale: cfg.generationRationale,
    notion_draft_preview: {
      mechanism: "Notion file_upload API → image block 挿入。caption は 'HP図解プレビュー: <slug> (対応仕様書: <name>)'。HP用 marker paragraph は残す。",
      filled_at_runtime: "scripts/diagrams/insert-preview.mjs が file_upload → block 挿入し、ここに { method, block_id, file_upload_id, caption } を後追記する",
    },
    bytes: webp.byteLength,
    generated_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    pipeline_origin: {
      repo: "x-post-pipeline",
      file: "lib/image-generator/concept-image-generate.mjs",
      summary: "POST https://api.openai.com/v1/images/generations with model gpt-image-2, Bearer OPENAI_API_KEY, b64_json response. HP 用は size/quality/output_format を上書きしつつ同じ認証経路と同じ no-text negative prompt 方針を踏襲。",
    },
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n")

  process.stdout.write(JSON.stringify({ ok: true, slug, image: imgPath, meta: metaPath, bytes: webp.byteLength }, null, 2) + "\n")
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`)
  process.exit(1)
})
