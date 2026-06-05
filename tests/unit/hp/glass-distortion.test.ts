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

function extractRgbaAlpha(source: string, customPropertyName: string) {
  const match = source.match(
    new RegExp(`${customPropertyName}:\\s*rgba\\([^)]*,\\s*([0-9.]+)\\)`),
  )
  if (!match) {
    throw new Error(`Missing rgba token: ${customPropertyName}`)
  }
  return Number(match[1])
}

describe("HP glass distortion contract", () => {
  it("keeps page aurora sources cinematic while limiting three-hue fields to the hero", () => {
    const css = readProjectFile("src/app/globals.css")
    const heroSurface = readProjectFile("src/components/hp/hero-deep-surface.ts")

    const alphas = [
      extractRgbaAlpha(css, "--aurora-purple"),
      extractRgbaAlpha(css, "--aurora-pink"),
      extractRgbaAlpha(css, "--aurora-sky"),
    ]

    expect(css).not.toContain("--aurora-red")
    expect(css).not.toContain("--aurora-blue")
    expect(alphas).toEqual([0.16, 0.11, 0.10])
    expect(heroSurface).toContain("rgba(245, 185, 214, 0.045)")
    expect(heroSurface).toContain("rgba(232, 160, 166, 0.035)")
    expect(heroSurface).toContain("rgba(174, 205, 236, 0.045)")
  })

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

    expect(filter).toContain("PROFILE_LENS_FILTER_ID")
    expect(filter).toContain("hp-profile-lens-distortion")
    expect(filter).toContain("PROFILE_LENS_MAP_DATA_URI")
    expect(filter).toContain("<feImage")
    expect(filter).toContain('result="profileLensMap"')
    expect(filter).toContain('result="profileStructuredLens"')
    expect(filter).toContain('result="profileRedDispersion"')
    expect(filter).toContain('result="profileGreenDispersion"')
    expect(filter).toContain('result="profileBlueDispersion"')
    expect(filter).toContain('result="profileRgbCaustics"')
    expect(filter).toContain("<feTurbulence")
    expect(filter).toContain("<feDisplacementMap")
    expect(filter).toContain("hp-liquid-glass-distortion")
    expect(filter).toContain("CSS.supports")
    expect(filter).toContain("hp-liquid-glass-enabled")
    expect(css).toContain("@supports")
    expect(css).toContain("backdrop-filter: url(\"#hp-liquid-glass-distortion\")")
    expect(css).toContain("backdrop-filter: url(\"#hp-profile-lens-distortion\")")
    expect(css).toContain(".hp-liquid-glass-enabled")
    expect(css).toContain("--hp-profile-lens-blur")
    expect(css).toContain("--hp-profile-lens-saturate")
    expect(css).toContain("--hp-profile-lens-opacity")
    expect(css).toContain("--hp-profile-lens-thickness")
    expect(css).toContain("--hp-profile-lens-bevel")
    expect(css).toContain("--hp-profile-dispersion")
    expect(css).toContain("--hp-profile-light-angle")
    expect(css).toContain("--hp-profile-front-specular-opacity")
    expect(css).toContain("--hp-profile-back-specular-opacity")

    const sharedScale = filter.match(
      /<feDisplacementMap[\s\S]*?scale="([0-9.]+)"[\s\S]*?xChannelSelector="R"[\s\S]*?yChannelSelector="G"/,
    )?.[1]
    const profileScale = filter.match(/scale=\{PROFILE_LENS_THICKNESS_SCALE\}/)?.[0]
    const profileDispersionScale = filter.match(
      /scale=\{PROFILE_LENS_THICKNESS_SCALE \+ PROFILE_LENS_DISPERSION_SCALE\}/,
    )?.[0]
    expect(Number(sharedScale)).toBeGreaterThanOrEqual(26)
    expect(Number(sharedScale)).toBeLessThanOrEqual(30)
    expect(profileScale).toBeDefined()
    expect(profileDispersionScale).toBeDefined()
  })

  it("uses a profile-only structured lens map instead of broadening the shared noise filter", () => {
    const css = readProjectFile("src/app/globals.css")
    const filter = readProjectFile("src/components/hp/glass-distortion-filter.tsx")
    const page = readProjectFile("src/app/page.tsx")

    expect(page).toContain("glass-card--hp-profile")
    expect(page).toContain("glass-distortion-surface")
    expect(filter).toMatch(/PROFILE_LENS_MAP_SVG[\s\S]*radialGradient/)
    expect(filter).toMatch(/PROFILE_LENS_MAP_SVG[\s\S]*linearGradient/)
    expect(filter).toContain('<stop offset="62%" stop-color="rgb(128,128,128)"')
    expect(filter).toContain('<stop offset="84%" stop-color="rgba(128,128,128,0)"')
    expect(filter).toMatch(/<feBlend[\s\S]*in="profileLensMap"[\s\S]*in2="profileMicroRipple"[\s\S]*result="profileStructuredLens"/)
    expect(filter).toMatch(/<feColorMatrix[\s\S]*result="profileRedChannel"/)
    expect(filter).toMatch(/<feColorMatrix[\s\S]*result="profileGreenChannel"/)
    expect(filter).toMatch(/<feColorMatrix[\s\S]*result="profileBlueChannel"/)
    expect(filter).toMatch(/<feDisplacementMap[\s\S]*in2="profileStructuredLens"[\s\S]*result="profileRedDispersion"/)
    expect(filter).toMatch(/<feDisplacementMap[\s\S]*in2="profileStructuredLens"[\s\S]*result="profileGreenDispersion"/)
    expect(filter).toMatch(/<feDisplacementMap[\s\S]*in2="profileStructuredLens"[\s\S]*result="profileBlueDispersion"/)
    expect(css).toContain(
      ".hp-liquid-glass-enabled .glass-card--hp-profile.glass-distortion-surface::before",
    )
    expect(css).toContain('url("#hp-profile-lens-distortion")')
    expect(css).toContain(
      ".hp-liquid-glass-enabled .glass-distortion-surface--subtle::before",
    )
  })

  it("models profile edge bevel thickness dispersion and directed rim highlights only on the profile surface", () => {
    const css = readProjectFile("src/app/globals.css")
    const filter = readProjectFile("src/components/hp/glass-distortion-filter.tsx")
    const profileBase = extractCssRule(css, ".glass-card--hp-profile")
    const profileSurface = extractCssRule(
      css,
      ".glass-card--hp-profile.glass-distortion-surface::before",
    )
    const enabledProfileSurface = extractCssRule(
      css,
      ".hp-liquid-glass-enabled .glass-card--hp-profile.glass-distortion-surface::before",
    )
    const foreground = extractCssRule(css, ".glass-distortion-foreground")

    expect(filter).toContain("PROFILE_LENS_THICKNESS_SCALE")
    expect(filter).toContain("PROFILE_LENS_DISPERSION_SCALE")
    expect(filter).toContain('result="profileRgbCaustics"')
    expect(profileBase).toContain("--hp-profile-lens-thickness: 18px")
    expect(profileBase).toContain("--hp-profile-lens-bevel: 12%")
    expect(profileBase).toContain("--hp-profile-dispersion: 0.07")
    expect(profileBase).toContain("--hp-profile-lens-opacity: 0.78")
    expect(profileBase).toContain("--hp-profile-light-angle: 132deg")
    expect(profileBase).toContain("--hp-profile-front-specular-opacity")
    expect(profileBase).toContain("--hp-profile-back-specular-opacity")
    expect(profileSurface).toContain("var(--hp-profile-lens-bevel)")
    expect(profileSurface).toContain("calc(100% - var(--hp-profile-lens-bevel) - 10%)")
    expect(profileSurface).toContain("linear-gradient(var(--hp-profile-light-angle)")
    expect(profileSurface).toContain("calc(var(--hp-profile-light-angle) + 180deg)")
    expect(profileSurface).toContain("var(--hp-profile-dispersion)")
    expect(profileSurface).toContain("rgba(255, 255, 255, 0) 88%")
    expect(enabledProfileSurface).toContain('url("#hp-profile-lens-distortion")')
    expect(enabledProfileSurface).not.toContain('url("#hp-liquid-glass-distortion")')
    expect(foreground).not.toMatch(/(?:filter|backdrop-filter):/)
  })

  it("keeps distortion on background layers and not on foreground text", () => {
    const css = readProjectFile("src/app/globals.css")
    const hero = readProjectFile("src/components/hp/hero-section.tsx")
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")
    const page = readProjectFile("src/app/page.tsx")

    expect(css).toMatch(/\.glass-distortion-surface::before[\s\S]*backdrop-filter/)
    const foreground = extractCssRule(css, ".glass-distortion-foreground")

    expect(foreground).toContain("z-index: 2")
    expect(foreground).not.toMatch(/(?:filter|backdrop-filter):/)
    expect(hero).toContain("glass-distortion-surface")
    expect(featuredWorks).toContain("glass-distortion-foreground")
    expect(featuredWorks).toContain("featured-work-transparent-card")
    expect(featuredWorks).toContain("featured-work-refraction-overlay")
    expect(page).toContain("glass-distortion-foreground")
  })

  it("removes the hero top-left glass shard while keeping at most one decorative shard", () => {
    const hero = readProjectFile("src/components/hp/hero-section.tsx")

    expect(hero).not.toContain("rotate-[-10deg]")
    expect(hero).not.toContain("left-6 top-32")

    const decorativeGlassShards = hero.match(/glass-card-sm glass-refraction-edge/g) ?? []
    expect(decorativeGlassShards).toHaveLength(1)
    expect(hero).toContain("rotate-[12deg]")
    expect(hero).toContain('data-hp-abstract-art="hero"')
  })

  it("keeps liquid distortion static and disables remaining motion for reduced motion users", () => {
    const css = readProjectFile("src/app/globals.css")
    const liquidSurface = extractCssRule(
      css,
      ".hp-liquid-glass-enabled .glass-distortion-surface::before",
    )

    expect(css).not.toContain("@keyframes hp-liquid-glass-shift")
    expect(css).not.toContain("hp-liquid-glass-shift")
    expect(css).toContain(".hp-liquid-glass-enabled .glass-distortion-surface::before")
    expect(liquidSurface).not.toContain("animation:")
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.hp-liquid-glass-enabled \.glass-card--hp-profile\.glass-distortion-surface::before[\s\S]*animation:\s*none/,
    )
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.glass-distortion-surface::before[\s\S]*animation:\s*none/,
    )
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.featured-work-refraction-overlay[\s\S]*transform:\s*none/,
    )
  })
})
