// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

function cssRule(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`))
  if (!match) {
    throw new Error(`Missing CSS rule: ${selector}`)
  }
  return match[1]
}

describe("HP profile glass lens target", () => {
  it("keeps the profile foreground outside any distortion plane", () => {
    const css = readProjectFile("src/app/globals.css")
    const page = readProjectFile("src/app/page.tsx")
    const foregroundRule = cssRule(css, ".glass-distortion-foreground")
    const profileClass = page.match(
      /className="([^"]*glass-card--hp-profile[^"]*)"/,
    )?.[1]

    expect(profileClass).toBeDefined()
    expect(profileClass).not.toContain("glass-card--showcase")
    expect(profileClass).not.toContain("glass-distortion-surface")
    expect(page).toContain("glass-distortion-foreground hp-shadow-sync-foreground")
    expect(foregroundRule).toContain("z-index: 2")
    expect(foregroundRule).not.toMatch(/(?:filter|backdrop-filter):/)
    expect(cssRule(css, ".glass-distortion-surface::before")).toContain("z-index: 1")
    expect(cssRule(css, ".hp-shadow-sync-layer")).toContain("z-index: 0")
  })

  it("removes the profile-only structured SVG lens", () => {
    const css = readProjectFile("src/app/globals.css")
    const filter = readProjectFile("src/components/hp/glass-distortion-filter.tsx")

    expect(filter).not.toContain("hp-profile-lens-distortion")
    expect(filter).not.toContain("PROFILE_LENS")
    expect(filter).not.toContain("profileLensMap")
    expect(filter).not.toContain("profileStructuredLens")
    expect(filter).not.toContain("profileRedDispersion")
    expect(css).not.toContain("hp-profile-lens-distortion")
    expect(css).not.toContain(".glass-card--hp-profile.glass-distortion-surface::before")
    expect(filter).toContain("hp-liquid-glass-distortion")
  })

  it("keeps the profile card as clean frosted glass with one drop shadow", () => {
    const css = readProjectFile("src/app/globals.css")
    const profileBase = cssRule(css, ".glass-card--hp-profile")

    expect(profileBase).toContain("background: rgba(255, 255, 255, 0.50)")
    expect(profileBase).toContain("backdrop-filter: blur(34px) saturate(1.38)")
    expect(profileBase).toContain("inset 0 1px 0 rgba(255, 255, 255, 0.90)")
    expect(profileBase).toContain("0 14px 34px rgba(30, 34, 42, 0.085)")
    expect(profileBase).not.toContain("inset 12px")
    expect(profileBase).not.toContain("inset -12px")
    expect(profileBase).not.toContain("--hp-profile-lens")
    expect(profileBase).not.toContain("--hp-profile-dispersion")
  })

  it("keeps the shared note and Featured Works distortion paths unchanged", () => {
    const css = readProjectFile("src/app/globals.css")
    const page = readProjectFile("src/app/page.tsx")
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")

    expect(page).toContain("glass-card-sm--hp-note")
    expect(featuredWorks).toContain("featured-work-refraction-overlay")
    expect(cssRule(css, ".hp-liquid-glass-enabled .glass-distortion-surface::before")).toContain(
      'backdrop-filter: url("#hp-liquid-glass-distortion") blur(20px) saturate(1.22)',
    )
    expect(cssRule(css, ".hp-liquid-glass-enabled .featured-work-refraction-overlay")).toContain(
      'backdrop-filter: url("#hp-liquid-glass-distortion")',
    )
  })

  it("keeps independent liquid motion removed and reduced-motion guarded", () => {
    const css = readProjectFile("src/app/globals.css")
    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]+?)\n\s*\}\n\}/,
    )?.[1]

    expect(css).not.toContain("@keyframes hp-liquid-glass-shift")
    expect(css).not.toContain("hp-liquid-glass-shift")
    expect(reducedMotionBlock).toContain(".glass-distortion-surface::before")
    expect(reducedMotionBlock).toContain(".featured-work-refraction-overlay")
    expect(reducedMotionBlock).not.toContain(
      ".hp-liquid-glass-enabled .glass-card--hp-profile.glass-distortion-surface::before",
    )
  })
})
