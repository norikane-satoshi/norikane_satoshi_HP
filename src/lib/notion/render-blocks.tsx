import type { ReactNode } from "react"
import Link from "next/link"
import { Tweet } from "react-tweet"
import type { RichTextItemResponse } from "@notionhq/client"
import { NoteDiagram } from "@/components/notes/note-diagram"
import { NoteVisual } from "@/components/notes/note-visual"
import { getDiagramConfig, parseDiagramMarker } from "@/lib/notes/diagrams"
import { resolveEmbed, type EmbedResolution } from "@/lib/notes/embeds"
import { getVisualConfig } from "@/lib/notes/visuals"
import type { BlockWithChildren } from "./types"

const LINK_CLASS =
  "underline underline-offset-4 decoration-[rgba(139,127,255,0.5)] hover:text-[var(--accent-primary)] hover:decoration-[var(--accent-primary)] transition-colors"

function normalizeId(id: string): string {
  return id.replace(/-/g, "").toLowerCase()
}

export type SlugIndex = Map<string, string>

export function buildSlugIndex(
  notes: { id: string; slug: string }[]
): SlugIndex {
  const m = new Map<string, string>()
  for (const n of notes) m.set(normalizeId(n.id), n.slug)
  return m
}

function applyAnnotations(
  text: string,
  r: RichTextItemResponse,
  key: string
): ReactNode {
  let node: ReactNode = text
  const a = r.annotations
  if (a.code) {
    node = (
      <code
        key={`${key}-c`}
        className="rounded bg-[rgba(139,127,255,0.10)] px-1.5 py-0.5 font-[var(--font-geist-mono)] text-[0.9em] text-hp"
      >
        {node}
      </code>
    )
  }
  if (a.italic) {
    node = (
      <em key={`${key}-i`} className="italic">
        {node}
      </em>
    )
  }
  if (a.bold) {
    node = (
      <strong key={`${key}-b`} className="font-semibold text-hp">
        {node}
      </strong>
    )
  }
  return node
}

function renderRichText(
  rich: RichTextItemResponse[],
  keyPrefix: string,
  slugIndex: SlugIndex
): ReactNode[] {
  return rich.map((r, i): ReactNode => {
    const key = `${keyPrefix}-${i}`

    if (r.type === "mention" && r.mention.type === "page") {
      const targetId = normalizeId(r.mention.page.id)
      const targetSlug = slugIndex.get(targetId)
      const label = r.plain_text
      if (targetSlug) {
        return (
          <Link key={key} href={`/notes/${targetSlug}`} className={LINK_CLASS}>
            {applyAnnotations(label, r, `${key}-m`)}
          </Link>
        )
      }
      return (
        <strong key={key} className="font-semibold text-hp">
          {label}
        </strong>
      )
    }

    const node = applyAnnotations(r.plain_text, r, key)
    const href = r.href
    if (href) {
      const isInternal = href.startsWith("/") && !href.startsWith("//")
      if (isInternal) {
        return (
          <Link key={key} href={href} className={LINK_CLASS}>
            {node}
          </Link>
        )
      }
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {node}
        </a>
      )
    }
    return <span key={key}>{node}</span>
  })
}

function richToPlain(rich: RichTextItemResponse[]): string {
  return rich.map((r) => r.plain_text).join("")
}

function resolveVisualSlug(slug: string): string {
  const retiredGradingSlug = ["grading", "words", "to", "knobs"].join("-")
  if (slug === retiredGradingSlug) return "grading-secret-pantry"
  return slug
}

function isEmptyParagraph(block: BlockWithChildren): boolean {
  if (block.type !== "paragraph") return false
  const rich = block.paragraph.rich_text
  return rich.length === 0 || richToPlain(rich).trim() === ""
}

function childrenOf(block: BlockWithChildren): BlockWithChildren[] {
  return block.children ?? []
}

function columnGridClass(count: number): string {
  if (count <= 1) return "md:grid-cols-1"
  if (count === 2) return "md:grid-cols-2"
  if (count === 3) return "md:grid-cols-3"
  if (count === 4) return "md:grid-cols-4"
  if (count === 5) return "md:grid-cols-5"
  return "md:grid-cols-6"
}

function renderChildren(
  block: BlockWithChildren,
  key: string,
  slugIndex: SlugIndex,
  depth: number
): ReactNode[] {
  return childrenOf(block).map((child, i) =>
    renderBlock(
      child,
      `${key}-c-${i}-${child.id.slice(0, 8)}`,
      slugIndex,
      depth + 1
    )
  )
}

function renderEmbed(
  resolution: EmbedResolution,
  key: string
): ReactNode {
  if (resolution.type === "tweet") {
    return (
      <div key={key} className="max-w-xl">
        <Tweet id={resolution.statusId} />
      </div>
    )
  }
  if (resolution.type === "iframe") {
    return (
      <div
        key={key}
        className={
          resolution.aspect === "video" ? "aspect-video" : "min-h-[320px]"
        }
      >
        <iframe
          src={resolution.src}
          title="Embedded content"
          loading="lazy"
          sandbox={resolution.sandbox}
          allow={resolution.allow}
          className="h-full w-full rounded"
        />
      </div>
    )
  }
  return (
    <a
      key={key}
      href={resolution.url}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
    >
      {resolution.hostLabel}
    </a>
  )
}

function extractUrlLikeValue(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null
  if (typeof value === "string") {
    return /^https?:\/\//.test(value) ? value : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractUrlLikeValue(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value !== "object") return null
  const record = value as Record<string, unknown>
  for (const key of ["url", "href"]) {
    const found = extractUrlLikeValue(record[key], depth + 1)
    if (found) return found
  }
  for (const entry of Object.values(record)) {
    const found = extractUrlLikeValue(entry, depth + 1)
    if (found) return found
  }
  return null
}

function renderBlock(
  block: BlockWithChildren,
  key: string,
  slugIndex: SlugIndex,
  depth: number
): ReactNode {
  // Notion exposes heading_1 / heading_2 / heading_3. We render them as
  // h2 / h3 / h4 respectively — the page's <h1> is the article title.
  if (block.type === "heading_1") {
    return (
      <h2
        key={key}
        className="mt-10 mb-5 text-xl font-semibold text-hp md:text-2xl"
      >
        {renderRichText(block.heading_1.rich_text, key, slugIndex)}
      </h2>
    )
  }
  if (block.type === "heading_2") {
    return (
      <h3
        key={key}
        className="mt-8 mb-4 text-lg font-semibold text-hp md:text-xl"
      >
        {renderRichText(block.heading_2.rich_text, key, slugIndex)}
      </h3>
    )
  }
  if (block.type === "heading_3") {
    return (
      <h4
        key={key}
        className="mt-6 mb-3 text-base font-semibold text-hp md:text-lg"
      >
        {renderRichText(block.heading_3.rich_text, key, slugIndex)}
      </h4>
    )
  }
  if (block.type === "paragraph") {
    if (isEmptyParagraph(block)) {
      return <div key={key} className="h-4 md:h-6" aria-hidden="true" />
    }
    // [[diagram:<slug>]] のみで構成された paragraph は図解コンポーネントに差し替える。
    // 解決順は v5 → v3 → raw paragraph フォールバック。
    //   1. v5 visuals registry に登録があれば NoteVisual (動画 / 静止画 / placeholder)
    //   2. それ以外は v3 DIAGRAM_REGISTRY を参照して旧 NoteDiagram で描画
    //   3. どちらにも無い slug は paragraph をそのまま出して raw marker を残す
    //      (本文側で誤記に気付けるようにする)
    const plain = richToPlain(block.paragraph.rich_text)
    const diagramSlug = parseDiagramMarker(plain)
    if (diagramSlug) {
      const visualSlug = resolveVisualSlug(diagramSlug)
      if (getVisualConfig(visualSlug)) {
        return <NoteVisual key={key} slug={visualSlug} />
      }
      const config = getDiagramConfig(diagramSlug)
      if (config) {
        return <NoteDiagram key={key} config={config} />
      }
    }
    return (
      <p key={key} className="leading-relaxed md:leading-[1.9]">
        {renderRichText(block.paragraph.rich_text, key, slugIndex)}
      </p>
    )
  }
  if (block.type === "divider") {
    return (
      <hr
        key={key}
        className="my-10 border-0 border-t border-t-[rgba(139,127,255,0.2)] md:my-12"
      />
    )
  }
  // image block は HP 側では描画しない。
  // - HP は [[diagram:<slug>]] marker を NoteDiagram に差し替えて表示しているため、
  //   Notion 下書きに参考プレビューとして挿入された image block を出すと二重描画になる。
  // - cc-notion 同期パイプラインが挿入する preview image block は caption 接頭辞
  //   `__preview__:<slug>` または file/external URL `/notes/diagrams/<slug>.preview.png`
  //   を持つ。ここで明示的にスキップ判定し、将来 image block 全般を render するように
  //   なっても preview block だけは確実に除外できるようにする。
  // - 旧仕様の "HP図解プレビュー: <slug>" caption も preview とみなして skip する
  //   (insert-preview.mjs 由来、過去ページに残っている可能性)。
  if (block.type === "image") {
    return null
  }
  if (block.type === "column_list") {
    const columns = childrenOf(block)
    const count = columns.length || 1
    return (
      <div
        key={key}
        className={`grid grid-cols-1 gap-6 ${columnGridClass(count)}`}
      >
        {columns.map((child, i) =>
          renderBlock(
            child,
            `${key}-col-${i}-${child.id.slice(0, 8)}`,
            slugIndex,
            depth + 1
          )
        )}
      </div>
    )
  }
  if (block.type === "column") {
    return (
      <div key={key} className="space-y-5">
        {renderChildren(block, key, slugIndex, depth)}
      </div>
    )
  }
  if (block.type === "quote") {
    return (
      <blockquote
        key={key}
        className="border-l-4 border-[var(--accent-primary)]/40 pl-4 italic text-hp"
      >
        {renderRichText(block.quote.rich_text, key, slugIndex)}
        {childrenOf(block).length > 0 ? (
          <div className="mt-4 space-y-5 not-italic">
            {renderChildren(block, key, slugIndex, depth)}
          </div>
        ) : null}
      </blockquote>
    )
  }
  if (block.type === "embed") {
    return renderEmbed(resolveEmbed(block.embed.url), key)
  }
  if (block.type === "video") {
    if (block.video.type === "external") {
      return renderEmbed(resolveEmbed(block.video.external.url), key)
    }
    return (
      <video
        key={key}
        controls
        className="w-full rounded"
        src={block.video.file.url}
      />
    )
  }

  const embeddedUrl = extractUrlLikeValue(block)
  if (embeddedUrl) {
    return renderEmbed(resolveEmbed(embeddedUrl), key)
  }

  return null
}

export function RenderBlocks({
  blocks,
  slugIndex,
}: {
  blocks: BlockWithChildren[]
  slugIndex: SlugIndex
}) {
  const out = blocks.map((block, i) => {
    const key = `b-${i}-${block.id.slice(0, 8)}`
    return renderBlock(block, key, slugIndex, 0)
  })
  // Unsupported block types are intentionally skipped.

  return (
    <div className="space-y-5 text-base text-hp md:text-[1.05rem]">{out}</div>
  )
}
