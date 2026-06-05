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

function expectNoProfileLens(source: string) {
  expect(source).not.toContain("hp-profile-lens-distortion")
  expect(source).not.toContain("PROFILE_LENS")
  expect(source).not.toContain("profileLensMap")
  expect(source).not.toContain("profileStructuredLens")
  expect(source).not.toContain("profileRedDispersion")
  expect(source).not.toContain("profileGreenDispersion")
  expect(source).not.toContain("profileBlueDispersion")
  expect(source).not.toContain("profileRgbCaustics")
  expect(source).not.toContain("--hp-profile-lens")
  expect(source).not.toContain("--hp-profile-dispersion")
  expect(source).not.toContain("--hp-profile-light-angle")
  expect(source).not.toContain("--hp-profile-specular-opacity")
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

  it("keeps only the shared SVG displacement enhancement", () => {
    const css = readProjectFile("src/app/globals.css")
    const filter = readProjectFile("src/components/hp/glass-distortion-filter.tsx")

    expectNoProfileLens(filter)
    expectNoProfileLens(css)
    expect(filter).toContain("hp-liquid-glass-distortion")
    expect(filter).toContain("CSS.supports")
    expect(filter).toContain("hp-liquid-glass-enabled")
    expect(filter).toContain("<feTurbulence")
    expect(filter).toContain("<feDisplacementMap")
    expect(css).toContain("@supports")
    expect(css).toContain("backdrop-filter: url(\"#hp-liquid-glass-distortion\")")
    expect(css).toContain(".hp-liquid-glass-enabled")

    const sharedScale = filter.match(
      /<feDisplacementMap[\s\S]*?scale="([0-9.]+)"[\s\S]*?xChannelSelector="R"[\s\S]*?yChannelSelector="G"/,
    )?.[1]
    expect(Number(sharedScale)).toBeGreaterThanOrEqual(26)
    expect(Number(sharedScale)).toBeLessThanOrEqual(30)
  })

  it("removes the profile card from the distortion surface while keeping foreground above shadows", () => {
    const css = readProjectFile("src/app/globals.css")
    const page = readProjectFile("src/app/page.tsx")
    const profileClass = page.match(
      /className="([^"]*glass-card--hp-profile[^"]*)"/,
    )?.[1]
    const foreground = extractCssRule(css, ".glass-distortion-foreground")

    expect(profileClass).toBeDefined()
    expect(profileClass).not.toContain("glass-card--showcase")
    expect(profileClass).not.toContain("glass-distortion-surface")
    expect(page).toContain("glass-distortion-foreground hp-shadow-sync-foreground")
    expect(foreground).toContain("z-index: 2")
    expect(foreground).not.toMatch(/(?:filter|backdrop-filter):/)
    expect(extractCssRule(css, ".hp-shadow-sync-layer")).toContain("z-index: 0")
    expect(css).not.toContain(".glass-card--hp-profile.glass-distortion-surface::before")
  })

  it("uses a clean shadow-only profile card baseline", () => {
    const css = readProjectFile("src/app/globals.css")
    const profileBase = extractCssRule(css, ".glass-card--hp-profile")

    expect(profileBase).toContain("background: rgba(255, 255, 255, 0.50)")
    expect(profileBase).toContain("backdrop-filter: blur(34px) saturate(1.38)")
    expect(profileBase).toContain("border-color: rgba(255, 255, 255, 0.72)")
    expect(profileBase).toContain("inset 0 1px 0 rgba(255, 255, 255, 0.90)")
    expect(profileBase).toContain("0 14px 34px rgba(30, 34, 42, 0.085)")
    expect(profileBase).not.toContain("inset 12px")
    expect(profileBase).not.toContain("inset -12px")
    expect(profileBase).not.toContain("var(--hp-profile-lens")
    expect(profileBase).not.toContain("var(--hp-profile-dispersion")
  })

  it("keeps distortion on shared background layers and not on foreground text", () => {
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

  it("keeps the shared note and Featured Works distortion paths unchanged", () => {
    const css = readProjectFile("src/app/globals.css")
    const page = readProjectFile("src/app/page.tsx")
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")

    expect(page).toContain("glass-card-sm--hp-note")
    expect(featuredWorks).toContain("featured-work-refraction-overlay")
    expect(extractCssRule(css, ".hp-liquid-glass-enabled .glass-distortion-surface::before")).toContain(
      'backdrop-filter: url("#hp-liquid-glass-distortion") blur(20px) saturate(1.22)',
    )
    expect(extractCssRule(css, ".hp-liquid-glass-enabled .featured-work-refraction-overlay")).toContain(
      'backdrop-filter: url("#hp-liquid-glass-distortion")',
    )
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
    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]+?)\n\s*\}\n\}/,
    )?.[1]

    expect(css).not.toContain("@keyframes hp-liquid-glass-shift")
    expect(css).not.toContain("hp-liquid-glass-shift")
    expect(css).toContain(".hp-liquid-glass-enabled .glass-distortion-surface::before")
    expect(liquidSurface).not.toContain("animation:")
    expect(reducedMotionBlock).toContain(".glass-distortion-surface::before")
    expect(reducedMotionBlock).toContain(".featured-work-refraction-overlay")
    expect(reducedMotionBlock).toContain("animation: none")
    expect(reducedMotionBlock).toContain("transform: none")
    expect(reducedMotionBlock).not.toContain(".glass-card--hp-profile.glass-distortion-surface::before")
  })
})
