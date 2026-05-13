import { describe, expect, it } from "vitest"

import {
  getVisualConfig,
  VISUAL_REGISTRY,
  type VisualKind,
} from "@/lib/notes/visuals"

describe("notes visual registry", () => {
  it("resolves registered visuals and returns null for unknown slugs", () => {
    expect(getVisualConfig("missing-visual")).toBeNull()

    const video = getVisualConfig("correction-labyrinth-to-factor")
    expect(video).toMatchObject({
      slug: "correction-labyrinth-to-factor",
      kind: "video",
      loopSec: 20,
    })

    const staticVisual = getVisualConfig("grading-visible-vs-hidden")
    expect(staticVisual).toMatchObject({
      slug: "grading-visible-vs-hidden",
      kind: "static",
      aspect: { width: 16, height: 9 },
    })
    expect(staticVisual?.loopSec).toBeUndefined()
  })

  it("keeps registry keys, slugs, dimensions, and kind contracts aligned", () => {
    const kinds = new Set<VisualKind>(["video", "static", "placeholder"])

    for (const [key, config] of Object.entries(VISUAL_REGISTRY)) {
      expect(config.slug).toBe(key)
      expect(kinds.has(config.kind)).toBe(true)
      expect(config.title.trim().length).toBeGreaterThan(0)
      expect(config.caption.trim().length).toBeGreaterThan(0)
      expect(config.alt.trim().length).toBeGreaterThan(0)
      expect(config.aspect.width).toBeGreaterThan(0)
      expect(config.aspect.height).toBeGreaterThan(0)

      if (config.kind === "video") {
        expect(config.loopSec).toBeGreaterThan(0)
      } else {
        expect(config.loopSec).toBeUndefined()
      }
    }
  })
})
