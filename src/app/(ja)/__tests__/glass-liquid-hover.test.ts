import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const css = readFileSync("src/app/globals.css", "utf8")

describe("shared glass liquid hover", () => {
  it("applies the bounded filter and border treatment to the shared glass utilities", () => {
    for (const className of ["glass-card", "glass-card-sm", "glass-badge", "glass-btn"]) {
      expect(css).toMatch(new RegExp(`\\.${className}:hover[\\s\\S]*?backdrop-filter: var\\(--hp-liquid-glass-hover-filter\\);`))
      expect(css).toMatch(new RegExp(`\\.${className}:hover[\\s\\S]*?border-color: var\\(--hp-liquid-glass-hover-border\\);`))
    }
  })

  it("uses the existing motion tokens and keeps the hover filter static for reduced motion", () => {
    expect(css).toContain("backdrop-filter var(--motion-duration-press) var(--ease-out-strong)")
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.glass-card:hover,[\s\S]*?backdrop-filter: var\(--hp-liquid-glass-filter\);/)
  })
})
