import { describe, expect, it } from "vitest"

import {
  DIAGRAM_REGISTRY,
  getDiagramConfig,
  parseDiagramMarker,
} from "@/lib/notes/diagrams"

describe("notes diagram registry", () => {
  it("parses exact diagram markers and rejects non-marker text", () => {
    expect(parseDiagramMarker("[[diagram:grading-look-decomposition]]")).toBe(
      "grading-look-decomposition"
    )
    expect(parseDiagramMarker("  [[diagram:Correction_01]]  ")).toBe(
      "Correction_01"
    )
    expect(parseDiagramMarker("[[diagram:bad slug]]")).toBeNull()
    expect(parseDiagramMarker("before [[diagram:slug]] after")).toBeNull()
  })

  it("resolves each supported layout with its required fields", () => {
    expect(getDiagramConfig("missing-diagram")).toBeNull()

    const layouts = new Set<string>()
    for (const [key, config] of Object.entries(DIAGRAM_REGISTRY)) {
      expect(config.slug).toBe(key)
      expect(config.aspect.width).toBeGreaterThan(0)
      expect(config.aspect.height).toBeGreaterThan(0)
      expect(config.title.trim().length).toBeGreaterThan(0)
      expect(config.caption.trim().length).toBeGreaterThan(0)
      expect(config.alt.trim().length).toBeGreaterThan(0)
      layouts.add(config.layout)

      switch (config.layout) {
        case "chaos-vs-structured":
          expect(config.chaosLabels.length).toBeGreaterThan(0)
          expect(config.structuredLayers.length).toBeGreaterThan(0)
          break
        case "centered-axes":
          expect(config.axes).toHaveLength(4)
          expect(config.hints.length).toBeGreaterThan(0)
          break
        case "horizontal-flow":
        case "horizontal-flow-8":
          expect(config.steps.length).toBeGreaterThan(0)
          expect(config.takeaway).toBeTruthy()
          break
        case "keypoint-row":
          expect(config.items.length).toBeGreaterThan(0)
          expect(config.items.every((item) => item.glyph)).toBe(true)
          break
        case "photo-strip":
          expect(config.photos.length).toBeGreaterThan(0)
          expect(config.photos.every((photo) => photo.src.startsWith("/"))).toBe(
            true
          )
          break
        case "quad-cards":
          expect(config.items.map((item) => item.opLabel)).toContain("乗算 (×)")
          break
        case "compare-pair":
          expect(config.cleanSide.nodes.length).toBeGreaterThan(0)
          expect(config.nestedSide.nodes.length).toBeGreaterThan(0)
          break
        case "triple-compare":
          expect(config.columns.map((column) => column.label)).toEqual([
            "Log",
            "Linear",
            "Gamma",
          ])
          break
      }
    }

    expect(layouts).toEqual(
      new Set([
        "chaos-vs-structured",
        "centered-axes",
        "horizontal-flow-8",
        "keypoint-row",
        "photo-strip",
        "quad-cards",
        "compare-pair",
        "triple-compare",
      ])
    )
  })
})
