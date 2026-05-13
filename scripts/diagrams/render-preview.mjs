#!/usr/bin/env node
/**
 * render-preview.mjs — Notion 上で図解の最終合成形を直接判断するための
 * preview PNG (背景画像 + HTML/CSS ラベル) を Playwright で生成する。
 *
 * 1 slug = 1 figure[data-diagram-slug="<slug>"] を localhost dev server から
 * element screenshot し、public/notes/diagrams/<slug>.preview.png に保存する。
 * 既存 PNG と同一内容なら書き換えない (mtime 維持)。
 * stdout には 1 slug 1 行 JSON で {slug, sha256, byteSize, route, status} を出力する。
 *
 * 前提: dev server が http://localhost:41237 で起動していること。
 *   起動していない場合は明確なエラーで停止する (npm run dev を促す)。
 *
 * 使い方:
 *   node scripts/diagrams/render-preview.mjs [--slug <slug>...]
 *   引数なしなら 10 slug 全て生成する。
 */
import { createHash } from "node:crypto"
import { readFile, writeFile, mkdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..", "..")
const OUT_DIR = resolve(REPO_ROOT, "public", "notes", "diagrams")
const DEV_BASE = process.env.HP_DEV_BASE || "http://localhost:41237"

// 1 slug は 1 記事に属する。記事 route (= /notes/<route>) でページを開いて
// figure を locator で掴む。
const SLUG_TO_ROUTE = {
  "correction-factor-map": "correction",
  "correction-scope-map": "correction",
  "correction-exposure-bracket": "correction",
  "correction-control-math": "correction",
  "correction-reversibility-compare": "correction",
  "correction-space-choice": "correction",
  "grading-look-decomposition": "grading",
  "grading-words-to-knobs": "grading",
  "filmlook-physics-flow": "filmlook",
  "filmlook-density-mixture": "filmlook",
}

const ALL_SLUGS = Object.keys(SLUG_TO_ROUTE)

function parseCli() {
  const { values } = parseArgs({
    options: {
      slug: { type: "string", multiple: true },
    },
  })
  const slugs = values.slug?.length ? values.slug : ALL_SLUGS
  for (const s of slugs) {
    if (!SLUG_TO_ROUTE[s]) throw new Error(`unknown slug: ${s}`)
  }
  return { slugs }
}

async function ensureDevServer() {
  try {
    const res = await fetch(`${DEV_BASE}/notes/correction`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok && res.status >= 500) {
      throw new Error(`dev server returned ${res.status}`)
    }
  } catch (e) {
    throw new Error(
      `dev server not reachable at ${DEV_BASE}.\n` +
        `Start it with:  npm run dev\n` +
        `(error: ${e.message})`,
    )
  }
}

async function loadPlaywright() {
  try {
    const mod = await import("playwright")
    return mod
  } catch {
    throw new Error(
      "playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium",
    )
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex")
}

async function maybeWrite(filePath, buf) {
  if (existsSync(filePath)) {
    const cur = await readFile(filePath)
    if (sha256(cur) === sha256(buf)) {
      return { written: false, byteSize: cur.length }
    }
  }
  await writeFile(filePath, buf)
  return { written: true, byteSize: buf.length }
}

async function shootSlug(page, slug) {
  const route = SLUG_TO_ROUTE[slug]
  const url = `${DEV_BASE}/notes/${route}`
  // route 単位でページを開き直す (1 ページに 1 〜 6 figure)。同じ route を続けて
  // 撮るときの再ナビゲーションは loadIfNeeded 相当で済むので毎回 goto する。
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
  const locator = page.locator(`figure[data-diagram-slug="${slug}"]`)
  await locator.first().waitFor({ state: "visible", timeout: 15000 })
  // figure 内の next/image が可視サイズで描画完了するまで一拍置く
  await page.waitForTimeout(400)
  const buf = await locator.first().screenshot({
    type: "png",
    omitBackground: false,
    timeout: 20000,
  })
  return { route, url, buf }
}

async function main() {
  const { slugs } = parseCli()
  await ensureDevServer()
  await mkdir(OUT_DIR, { recursive: true })
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  })
  const page = await context.newPage()
  try {
    for (const slug of slugs) {
      const { route, url, buf } = await shootSlug(page, slug)
      const filePath = resolve(OUT_DIR, `${slug}.preview.png`)
      const { written, byteSize } = await maybeWrite(filePath, buf)
      const out = {
        ok: true,
        slug,
        route,
        url,
        path: filePath.replace(`${REPO_ROOT}/`, ""),
        sha256: sha256(buf),
        byteSize,
        written,
      }
      process.stdout.write(JSON.stringify(out) + "\n")
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`)
  process.exit(1)
})
