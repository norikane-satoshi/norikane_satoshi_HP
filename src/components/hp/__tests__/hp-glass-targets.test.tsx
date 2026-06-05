// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const pageSource = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8")
const calendarEmbedSource = readFileSync(
  join(process.cwd(), "src/components/hp/calendar-embed.tsx"),
  "utf8",
)
const homeScheduleSource = readFileSync(
  join(process.cwd(), "src/components/hp/home-schedule-section.tsx"),
  "utf8",
)
const profilePhotoSource = readFileSync(
  join(process.cwd(), "src/components/hp/profile-photo.tsx"),
  "utf8",
)
const featuredWorksSource = readFileSync(
  join(process.cwd(), "src/components/hp/featured-works.tsx"),
  "utf8",
)
const globalsCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = globalsCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  expect(match, `${selector} should be defined`).not.toBeNull()
  return match?.[1] ?? ""
}

function expectNeutralSurface(rule: string) {
  const tintedSurfaceValues = [
    "rgba(117, 104, 214",
    "rgba(54, 111, 204",
    "rgba(54, 44, 108",
    "rgba(33, 53, 98",
    "rgba(28, 15, 110",
  ]

  for (const value of tintedSurfaceValues) {
    expect(rule).not.toContain(value)
  }
}

function occurrences(source: string, pattern: string) {
  return source.split(pattern).length - 1
}

describe("HP targeted glass contracts", () => {
  it("targets notes profile and schedule glass without broadening Featured Works", () => {
    expect(pageSource).toContain(
      "glass-card-sm glass-card-sm--hp-note hp-shadow-sync-surface hp-shadow-sync-surface--note glass-refraction-edge glass-distortion-surface",
    )
    expect(pageSource).toContain(
      "glass-card glass-card--showcase glass-card--hp-profile hp-shadow-sync-surface hp-shadow-sync-surface--profile glass-distortion-surface",
    )
    expect(homeScheduleSource).toContain(
      "glass-card glass-card--hp-schedule hp-shadow-sync-surface hp-shadow-sync-surface--schedule",
    )
    expect(calendarEmbedSource).toContain("glass-inset glass-inset--hp-schedule")

    expect(cssRule(".glass-card-sm--hp-note")).toContain("saturate(1.42)")
    expect(cssRule(".glass-card--hp-profile")).toContain("blur(34px)")
    expect(cssRule(".glass-card--hp-profile")).toContain("--hp-profile-lens-thickness")
    expect(cssRule(".glass-card--hp-profile")).toContain("--hp-profile-lens-bevel")
    expect(cssRule(".glass-card--hp-profile")).toContain("--hp-profile-dispersion")
    expect(cssRule(".glass-card--hp-profile")).toContain("--hp-profile-light-angle")
    expect(cssRule(".glass-card--hp-schedule")).toContain("blur(30px)")
    expect(cssRule(".glass-inset--hp-schedule")).toContain("inset")
    expect(cssRule(".featured-work-transparent-card")).toContain(
      "backdrop-filter: none",
    )
  })

  it("removes card-shaped refracted shadows and their independent motion", () => {
    expect(pageSource).not.toContain("hp-refracted-shadow-card")
    expect(homeScheduleSource).not.toContain("hp-refracted-shadow-card")
    expect(profilePhotoSource).not.toContain("hp-refracted-shadow-card")
    expect(featuredWorksSource).not.toContain("hp-refracted-shadow-card")
    expect(globalsCss).not.toContain(".hp-refracted-shadow-card")
    expect(globalsCss).not.toContain("hp-refracted-shadow-card__shadow")
    expect(globalsCss).not.toContain("@keyframes hp-refracted-shadow-breathe")
    expect(globalsCss).not.toContain("hp-refracted-shadow-breathe")
    expect(globalsCss).not.toContain("@keyframes hp-liquid-glass-shift")
    expect(globalsCss).not.toContain("hp-liquid-glass-shift")

    expect(pageSource).not.toContain('aria-hidden="true" className="hp-refracted-shadow')
    expect(homeScheduleSource).not.toContain('aria-hidden="true" className="hp-refracted-shadow')
  })

  it("puts positive-y element shadows below the glass and keeps foreground elements unfiltered", () => {
    const rootRule = cssRule(":root")
    expect(rootRule).toContain("--hp-element-shadow-x")
    expect(rootRule).toContain("--hp-element-shadow-y")
    expect(rootRule).toContain("--hp-element-shadow-blur")
    expect(rootRule).toContain("--hp-element-shadow-color")
    expect(rootRule).toContain("--hp-featured-shadow-y")
    expect(rootRule).not.toMatch(/--hp-(?:element|featured)-shadow-[a-z-]*y:\s*-/)

    expect(cssRule(".hp-shadow-sync-surface")).toContain("isolation: isolate")
    expect(cssRule(".hp-shadow-sync-surface")).toContain("overflow: hidden")
    expect(cssRule(".glass-distortion-surface::before")).toContain("z-index: 1")
    expect(cssRule(".hp-shadow-sync-foreground")).toContain("z-index: 2")

    expect(cssRule(".hp-shadow-sync-layer")).toContain("z-index: 0")
    expect(cssRule(".hp-shadow-clone-element")).toContain(
      "drop-shadow(var(--hp-element-shadow-x) var(--hp-element-shadow-y) var(--hp-element-shadow-blur) var(--hp-element-shadow-color))",
    )
    expect(cssRule(".hp-shadow-clone-text")).toContain(
      "text-shadow: var(--hp-element-shadow-x) var(--hp-element-text-shadow-y) var(--hp-element-text-shadow-blur) var(--hp-element-shadow-color)",
    )
    expect(cssRule(".hp-shadow-sync-element")).not.toContain("drop-shadow(")
    expect(cssRule(".hp-shadow-sync-text")).not.toContain("text-shadow:")
    expect(cssRule(".hp-shadow-sync-surface--note")).toContain("--hp-element-shadow-y: 8px")
    expect(cssRule(".hp-shadow-sync-surface--profile")).toContain("--hp-element-shadow-y: 10px")
    expect(cssRule(".hp-shadow-sync-surface--schedule")).toContain("--hp-element-shadow-y: 10px")
  })

  it("attaches shadow-only layers to profile notes schedule and Featured Works elements", () => {
    expect(pageSource).toContain("hp-shadow-sync-layer hp-note-shadow-layer")
    expect(pageSource).toContain("hp-shadow-sync-layer hp-profile-shadow-layer")
    expect(homeScheduleSource).toContain("hp-shadow-sync-layer hp-schedule-shadow-layer")
    expect(pageSource).toContain("hp-shadow-clone-text hp-profile-text-shadow")
    expect(pageSource).toContain("hp-shadow-clone-element hp-profile-photo-shadow")
    expect(pageSource).toContain("hp-shadow-clone-element hp-profile-tool-shadow")
    expect(pageSource).toContain("hp-shadow-clone-element hp-profile-social-shadow")
    expect(homeScheduleSource).toContain("hp-shadow-clone-element hp-schedule-widget-shadow")
    expect(profilePhotoSource).not.toContain("hp-profile-photo-shadow")
    expect(pageSource).not.toContain("hp-shadow-sync-text hp-profile-text-shadow")
    expect(homeScheduleSource).not.toContain("hp-shadow-sync-text hp-schedule-text-shadow")

    expect(featuredWorksSource).toContain("hp-featured-shadow-media")
    expect(featuredWorksSource).toContain("hp-featured-shadow-text")
    expect(featuredWorksSource).toContain("hp-featured-shadow-layer")
    expect(featuredWorksSource).toContain("hp-featured-shadow-track")
    expect(featuredWorksSource).toContain("hp-featured-shadow-clone-media")
    expect(featuredWorksSource).toContain("hp-featured-shadow-clone-text")
    expect(featuredWorksSource).toContain("hp-featured-shadow-clone-badge")
    expect(featuredWorksSource).toContain("data-featured-work-shadow-layer")
    expect(featuredWorksSource).toContain("useFeaturedWorkShadowScrollSync")

    expect(cssRule(".hp-featured-shadow-media")).not.toContain("drop-shadow(")
    expect(cssRule(".hp-featured-shadow-text")).not.toContain("text-shadow:")
    expect(cssRule(".hp-featured-shadow-layer")).toContain("z-index: 0")
    expect(cssRule(".hp-featured-shadow-track")).toContain("transform: translate3d(var(--hp-featured-shadow-scroll-x, 0px), 0, 0)")
    expect(cssRule(".hp-featured-shadow-clone-media")).toContain(
      "drop-shadow(var(--hp-featured-shadow-x) var(--hp-featured-shadow-y) var(--hp-featured-shadow-blur) var(--hp-featured-shadow-color))",
    )
    expect(cssRule(".hp-featured-shadow-clone-text::before")).toContain("text-shadow:")
    expect(cssRule(".hp-featured-shadow-clone-badge")).toContain(
      "drop-shadow(var(--hp-featured-shadow-x) var(--hp-featured-shadow-y) var(--hp-featured-shadow-blur) var(--hp-featured-shadow-color))",
    )
    expect(cssRule(".featured-work-transparent-card")).toContain("backdrop-filter: none")
  })

  it("keeps the liquid distortion stronger without adding another blur layer", () => {
    const liquidSurface = cssRule(
      ".hp-liquid-glass-enabled .glass-distortion-surface::before",
    )

    expect(liquidSurface).not.toContain("animation:")
    expect(cssRule(".glass-distortion-surface::before")).not.toContain("translate3d")
    expect(liquidSurface).toContain(
      'backdrop-filter: url("#hp-liquid-glass-distortion") blur(20px) saturate(1.22)',
    )
    expect(liquidSurface).toContain("opacity: 0.95")
    expect(cssRule(".hp-liquid-glass-enabled .glass-distortion-surface--subtle::before")).toContain(
      "opacity: 0.60",
    )
  })

  it("keeps the profile lens as one curved RGB-dispersed surface with directed double specular", () => {
    const filterSource = readFileSync(
      join(process.cwd(), "src/components/hp/glass-distortion-filter.tsx"),
      "utf8",
    )
    const profileBase = cssRule(".glass-card--hp-profile")
    const profileSurface = cssRule(".glass-card--hp-profile.glass-distortion-surface::before")
    const enabledProfileSurface = cssRule(
      ".hp-liquid-glass-enabled .glass-card--hp-profile.glass-distortion-surface::before",
    )

    expect(filterSource).toContain("PROFILE_LENS_THICKNESS_SCALE")
    expect(filterSource).toContain("PROFILE_LENS_DISPERSION_SCALE")
    expect(filterSource).toContain('result="profileRedChannel"')
    expect(filterSource).toContain('result="profileGreenChannel"')
    expect(filterSource).toContain('result="profileBlueChannel"')
    expect(filterSource).toContain('result="profileRedDispersion"')
    expect(filterSource).toContain('result="profileGreenDispersion"')
    expect(filterSource).toContain('result="profileBlueDispersion"')
    expect(filterSource).toContain('result="profileRgbCaustics"')
    expect(filterSource).toMatch(/scale=\{PROFILE_LENS_THICKNESS_SCALE \+ PROFILE_LENS_DISPERSION_SCALE\}/)
    expect(filterSource).toMatch(/scale=\{PROFILE_LENS_THICKNESS_SCALE - PROFILE_LENS_DISPERSION_SCALE\}/)

    expect(profileBase).toContain("--hp-profile-lens-thickness: 26px")
    expect(profileBase).toContain("--hp-profile-lens-bevel: 18%")
    expect(profileBase).toContain("--hp-profile-dispersion: 0.16")
    expect(profileBase).toContain("--hp-profile-light-angle: 132deg")
    expect(profileBase).toContain("--hp-profile-front-specular-opacity")
    expect(profileBase).toContain("--hp-profile-back-specular-opacity")
    expect(profileSurface).toContain("var(--hp-profile-lens-bevel)")
    expect(profileSurface).toContain("var(--hp-profile-light-angle)")
    expect(profileSurface).toContain("calc(var(--hp-profile-light-angle) + 180deg)")
    expect(profileSurface).toContain("var(--hp-profile-dispersion)")
    expect(enabledProfileSurface).toContain('url("#hp-profile-lens-distortion")')
    expect(enabledProfileSurface).not.toContain('url("#hp-liquid-glass-distortion")')
  })

  it("adds one fixed transparent Featured Works refraction overlay on the non-scrolling shell", () => {
    expect(featuredWorksSource).toContain("data-featured-work-marquee-shell")
    expect(featuredWorksSource).toContain("featured-work-content-viewport")
    expect(featuredWorksSource).toContain('className="featured-work-refraction-overlay"')
    expect(featuredWorksSource).toContain('aria-hidden="true"')
    expect(occurrences(featuredWorksSource, "featured-work-refraction-overlay")).toBe(1)
    expect(featuredWorksSource).toMatch(
      /data-featured-work-shadow-layer[\s\S]+className="featured-work-refraction-overlay"[\s\S]+data-featured-work-marquee-viewport="true"/,
    )

    const overlayRule = cssRule(".featured-work-refraction-overlay")
    expect(overlayRule).toContain("background: transparent")
    expect(overlayRule).toContain("border: 0")
    expect(overlayRule).toContain("box-shadow: none")
    expect(overlayRule).toContain("pointer-events: none")
    expect(overlayRule).toContain("position: absolute")
    expect(overlayRule).toContain("inset: 0")
    expect(overlayRule).toContain("z-index: 1")

    const enabledOverlayRule = cssRule(
      ".hp-liquid-glass-enabled .featured-work-refraction-overlay",
    )
    expect(enabledOverlayRule).toContain('backdrop-filter: url("#hp-liquid-glass-distortion")')
    expect(enabledOverlayRule).toContain("-webkit-backdrop-filter")
    expect(enabledOverlayRule).not.toContain("blur(")
    expect(enabledOverlayRule).not.toContain("animation:")
  })

  it("makes profile tool and social badges strong transparent glass buttons", () => {
    expect(pageSource).toContain("glass-badge glass-badge--profile-tool")
    expect(pageSource).toContain("glass-btn glass-btn--profile-social")

    const toolBadge = cssRule(".glass-badge--profile-tool")
    const socialButton = cssRule(".glass-btn--profile-social")
    expect(toolBadge).toContain("rgba(255, 255, 255, 0.58)")
    expect(toolBadge).toContain("inset")
    expect(toolBadge).not.toContain("background: var(--accent-primary)")
    expect(socialButton).toContain("rgba(255, 255, 255, 0.52)")
    expect(socialButton).toContain("inset")
    expect(socialButton).not.toContain("background: var(--accent-primary)")
  })

  it("keeps glass surface fill border and shadow neutral while preserving transparency blur edge and inset depth", () => {
    expect(globalsCss).toContain("--glass-bg: rgba(255, 255, 255, 0.")
    expect(globalsCss).toContain("--glass-border: rgba(255, 255, 255,")
    expectNeutralSurface(cssRule(":root"))

    const surfaceSelectors = [
      ".glass-card",
      ".glass-card--showcase",
      ".glass-card--hp-profile",
      ".glass-card--hp-schedule",
      ".glass-card-sm",
      ".glass-card-sm--hp-note",
      ".glass-refraction-edge",
      ".glass-distortion-surface::before",
      ".hp-shadow-sync-surface",
      ".hp-shadow-clone-element",
      ".hp-featured-shadow-clone-media",
      ".hp-featured-shadow-clone-badge",
      ".glass-badge",
      ".glass-badge--profile-tool",
      ".glass-btn--profile-social",
      ".glass-inset--hp-schedule",
    ]

    for (const selector of surfaceSelectors) {
      expectNeutralSurface(cssRule(selector))
    }

    expect(cssRule(".glass-card")).toContain("backdrop-filter: blur(24px)")
    expect(cssRule(".glass-refraction-edge")).toContain("rgba(255, 255, 255")
    expect(cssRule(".glass-card--hp-profile")).toContain("inset")
    expect(cssRule(".glass-card--hp-schedule")).toContain("inset")
    expect(cssRule(".glass-badge--profile-tool")).toContain("inset")
  })

  it("turns off motion in reduced-motion mode while keeping static shadows", () => {
    const reducedMotionBlock = globalsCss.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]+?)\n\s*\}\n\}/,
    )

    expect(reducedMotionBlock?.[1]).toContain(".hp-shadow-clone-element")
    expect(reducedMotionBlock?.[1]).toContain(".hp-featured-shadow-media")
    expect(reducedMotionBlock?.[1]).toContain(".hp-featured-shadow-track")
    expect(reducedMotionBlock?.[1]).toContain(".featured-work-refraction-overlay")
    expect(reducedMotionBlock?.[1]).toContain(
      ".hp-liquid-glass-enabled .glass-card--hp-profile.glass-distortion-surface::before",
    )
    expect(reducedMotionBlock?.[1]).toContain("animation: none")
    expect(reducedMotionBlock?.[1]).toContain("transform: none")
    expect(reducedMotionBlock?.[1]).not.toContain("filter: none")
  })
})
