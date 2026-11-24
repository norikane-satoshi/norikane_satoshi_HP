import { parseDiagramMarker } from "@/lib/notes/domain/diagrams"
import type { BlockWithChildren } from "@/lib/notion/server/types"

export function extractNoteExcerpt(blocks: readonly BlockWithChildren[], maxLength = 120): string {
  let text = ""
  for (const block of blocks) {
    if (block.type !== "paragraph") continue
    const plain = block.paragraph.rich_text
      .map((item) => item.plain_text)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (!plain || parseDiagramMarker(plain)) continue
    text += plain
    if (text.length >= maxLength) break
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}
