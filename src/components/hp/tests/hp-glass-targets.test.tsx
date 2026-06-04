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
  it("keeps the profile foreground outside the distortion plane", () => {
    const css = readProjectFile("src/app/globals.css")
    const page = readProjectFile("src/app/page.tsx")
    const foregroundRule = cssRule(css, ".glass-distortion-foreground")

    expect(page).toContain(
      "glass-card glass-card--showcase glass-card--hp-profile hp-shadow-sync-surface hp-shadow-sync-surface--profile glass-distortion-surface",
    )
    expect(page).toContain("glass-distortion-foreground hp-shadow-sync-foreground")
    expect(foregroundRule).toContain("z-index: 2")
    expect(foregroundRule).not.toMatch(/(?:filter|backdrop-filter):/)
    expect(cssRule(css, ".glass-distortion-surface::before")).toContain("z-index: 1")
    expect(cssRule(css, ".hp-shadow-sync-layer")).toContain("z-index: 0")
  })

  it("uses one profile-only lens backdrop layer with structured center-to-edge displacement", () => {
    const css = readProjectFile("src/app/globals.css")
    const filter = readProjectFile("src/components/hp/glass-distortion-filter.tsx")
    const profileRule = cssRule(
      css,
      ".hp-liquid-glass-enabled .glass-card--hp-profile.glass-distortion-surface::before",
    )

    expect(filter).toContain("hp-profile-lens-distortion")
    expect(filter).toContain("PROFILE_LENS_MAP_DATA_URI")
    expect(filter).toMatch(/PROFILE_LENS_MAP_SVG[\s\S]*radialGradient/)
    expect(filter).toMatch(/PROFILE_LENS_MAP_SVG[\s\S]*linearGradient/)
    expect(filter).toMatch(/<feImage[\s\S]*result="profileLensMap"/)
    expect(filter).toMatch(/<feBlend[\s\S]*result="profileStructuredLens"/)
    expect(filter).toMatch(/<feDisplacementMap[\s\S]*in2="profileStructuredLens"/)
    expect(profileRule).toContain('backdrop-filter: url("#hp-profile-lens-distortion")')
    expect(profileRule).toContain("blur(var(--hp-profile-lens-blur))")
    expect(profileRule).toContain("saturate(var(--hp-profile-lens-saturate))")
    expect(profileRule).not.toContain("animation:")
  })

  it("defines profile specular edge tokens without adding another backdrop-filter layer", () => {
    const css = readProjectFile("src/app/globals.css")
    const profileBase = cssRule(css, ".glass-card--hp-profile")
    const profileSurface = cssRule(css, ".glass-card--hp-profile.glass-distortion-surface::before")
    const enabledProfile = cssRule(
      css,
      ".hp-liquid-glass-enabled .glass-card--hp-profile.glass-distortion-surface::before",
    )

    expect(profileBase).toContain("--hp-profile-lens-blur")
    expect(profileBase).toContain("--hp-profile-lens-saturate")
    expect(profileBase).toContain("--hp-profile-lens-opacity")
    expect(profileBase).toContain("--hp-profile-specular-opacity")
    expect(profileSurface).toContain("radial-gradient")
    expect(profileSurface).toContain("linear-gradient")
    expect(profileSurface).toContain("var(--hp-profile-specular-opacity)")
    expect(enabledProfile.match(/^      backdrop-filter:/gm)).toHaveLength(1)
    expect(enabledProfile.match(/-webkit-backdrop-filter:/g)).toHaveLength(1)
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

    expect(css).not.toContain("@keyframes hp-liquid-glass-shift")
    expect(css).not.toContain("hp-liquid-glass-shift")
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.hp-liquid-glass-enabled \.glass-card--hp-profile\.glass-distortion-surface::before[\s\S]*animation:\s*none/,
    )
  })
})
