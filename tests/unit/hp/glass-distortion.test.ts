import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

function extractCssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`))
  if (!match) {
    throw new Error(`Missing CSS rule: ${selector}`)
  }
  return match[1]
}

describe("HP glass distortion contract", () => {
  it("keeps the standard glass base while defining a refraction edge utility", () => {
    const css = readProjectFile("src/app/globals.css")
    const glassCard = extractCssRule(css, ".glass-card")
    const glassCardSm = extractCssRule(css, ".glass-card-sm")
    const refractionSurface = extractCssRule(css, ".glass-refraction-edge")

    expect(glassCard).toContain("backdrop-filter: blur(24px) saturate(1.2);")
    expect(glassCard).toContain("-webkit-backdrop-filter: blur(24px) saturate(1.2);")
    expect(glassCardSm).toContain("backdrop-filter: blur(12px);")
    expect(glassCardSm).toContain("-webkit-backdrop-filter: blur(12px);")
    expect(refractionSurface).toContain("inset 0 -1px 0")
    expect(refractionSurface).toContain("linear-gradient")
    expect(refractionSurface).toContain("outline:")
    expect(refractionSurface).not.toContain("neu-")
  })

  it("defines SVG displacement as a guarded enhancement", () => {
    const css = readProjectFile("src/app/globals.css")
    const filter = readProjectFile("src/components/hp/glass-distortion-filter.tsx")

    expect(filter).toContain("<feTurbulence")
    expect(filter).toContain("<feDisplacementMap")
    expect(filter).toContain("hp-liquid-glass-distortion")
    expect(filter).toContain("CSS.supports")
    expect(filter).toContain("hp-liquid-glass-enabled")
    expect(css).toContain("@supports")
    expect(css).toContain("backdrop-filter: url(\"#hp-liquid-glass-distortion\")")
    expect(css).toContain(".hp-liquid-glass-enabled")
  })

  it("keeps distortion on background layers and not on foreground text", () => {
    const css = readProjectFile("src/app/globals.css")
    const hero = readProjectFile("src/components/hp/hero-section.tsx")
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")
    const page = readProjectFile("src/app/page.tsx")

    expect(css).toMatch(/\.glass-distortion-surface::before[\s\S]*backdrop-filter/)
    const foreground = extractCssRule(css, ".glass-distortion-foreground")

    expect(foreground).toContain("z-index: 1")
    expect(foreground).not.toMatch(/(?:filter|backdrop-filter):/)
    expect(hero).toContain("glass-distortion-surface")
    expect(featuredWorks).toContain("glass-distortion-foreground")
    expect(page).toContain("glass-distortion-foreground")
  })

  it("stops the distortion animation for reduced motion users", () => {
    const css = readProjectFile("src/app/globals.css")

    expect(css).toContain("@keyframes hp-liquid-glass-shift")
    expect(css).toContain(".hp-liquid-glass-enabled .glass-distortion-surface::before")
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.glass-distortion-surface::before[\s\S]*animation:\s*none/,
    )
  })
})
