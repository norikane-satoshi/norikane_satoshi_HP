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

describe("HP targeted glass contracts", () => {
  it("targets notes profile and schedule glass without broadening Featured Works", () => {
    expect(pageSource).toContain(
      "glass-card-sm glass-card-sm--hp-note hp-refracted-shadow-card hp-refracted-shadow-card--note glass-refraction-edge glass-distortion-surface",
    )
    expect(pageSource).toContain(
      "glass-card glass-card--showcase glass-card--hp-profile hp-refracted-shadow-card hp-refracted-shadow-card--profile glass-distortion-surface",
    )
    expect(homeScheduleSource).toContain(
      "glass-card glass-card--hp-schedule hp-refracted-shadow-card hp-refracted-shadow-card--schedule",
    )
    expect(calendarEmbedSource).toContain("glass-inset glass-inset--hp-schedule")

    expect(cssRule(".glass-card-sm--hp-note")).toContain("saturate(1.42)")
    expect(cssRule(".glass-card--hp-profile")).toContain("blur(34px)")
    expect(cssRule(".glass-card--hp-schedule")).toContain("blur(30px)")
    expect(cssRule(".glass-inset--hp-schedule")).toContain("inset")
    expect(cssRule(".featured-work-transparent-card")).toContain(
      "backdrop-filter: none",
    )
  })

  it("binds the refracted shadow to only the notes profile and schedule cards", () => {
    expect(pageSource).toContain(
      "glass-card-sm glass-card-sm--hp-note hp-refracted-shadow-card hp-refracted-shadow-card--note",
    )
    expect(pageSource).toContain(
      "glass-card glass-card--showcase glass-card--hp-profile hp-refracted-shadow-card hp-refracted-shadow-card--profile",
    )
    expect(homeScheduleSource).toContain(
      "glass-card glass-card--hp-schedule hp-refracted-shadow-card hp-refracted-shadow-card--schedule",
    )

    expect(pageSource).toContain("hp-refracted-shadow-card__shadow")
    expect(homeScheduleSource).toContain("hp-refracted-shadow-card__shadow")
    expect(homeScheduleSource).toContain("glass-distortion-foreground")

    expect(pageSource).not.toContain("hp-refracted-shadow-section")
    expect(homeScheduleSource).not.toContain("hp-refracted-shadow-section")
    expect(pageSource).not.toContain("hp-refracted-shadow-card--hero")
    expect(pageSource).not.toContain("hp-refracted-shadow-card--featured")
    expect(pageSource).not.toContain("FeaturedWorks hp-refracted-shadow-card")
  })

  it("uses a card-shaped positive-y shadow without the old corner ellipse field", () => {
    const rootRule = cssRule(":root")
    expect(rootRule).toContain("--hp-refracted-shadow-opacity")
    expect(rootRule).toContain("--hp-refracted-shadow-blur")
    expect(rootRule).toContain("--hp-refracted-shadow-y")
    expect(rootRule).toContain("--hp-refracted-shadow-spread")
    expect(rootRule).not.toMatch(/--hp-refracted-shadow-[a-z-]*y:\s*-/)

    expect(cssRule(".hp-refracted-shadow-card")).toContain("isolation: isolate")
    expect(cssRule(".hp-refracted-shadow-card")).toContain("position: relative")

    const shadowRule = cssRule(".hp-refracted-shadow-card__shadow")
    expect(shadowRule).toContain("border-radius: inherit")
    expect(shadowRule).toContain("background: rgba(30, 34, 42, 0.24)")
    expect(shadowRule).toContain("filter: blur(var(--hp-refracted-shadow-blur))")
    expect(shadowRule).toContain(
      "transform: translate3d(var(--hp-refracted-shadow-x), var(--hp-refracted-shadow-y), 0)",
    )
    expect(shadowRule).toContain("z-index: -1")
    expect(shadowRule).not.toContain("radial-gradient(ellipse 58% 30% at 22% 8%")
    expect(shadowRule).not.toContain("radial-gradient(ellipse 62% 34% at 78% 92%")

    expect(cssRule(".hp-refracted-shadow-card--note")).toContain(
      "--hp-refracted-shadow-y: 12px",
    )
    expect(cssRule(".hp-refracted-shadow-card--profile")).toContain(
      "--hp-refracted-shadow-y: 20px",
    )
    expect(cssRule(".hp-refracted-shadow-card--schedule")).toContain(
      "--hp-refracted-shadow-y: 18px",
    )

    expect(globalsCss).not.toContain(".hp-refracted-shadow-section::before")
    expect(globalsCss).not.toContain("--hp-refracted-shadow-notes-y")
    expect(globalsCss).not.toContain("--hp-refracted-shadow-profile-y")
    expect(globalsCss).not.toContain("--hp-refracted-shadow-schedule-y")
  })

  it("keeps the liquid distortion stronger without adding another blur layer", () => {
    const liquidSurface = cssRule(
      ".hp-liquid-glass-enabled .glass-distortion-surface::before",
    )

    expect(liquidSurface).toContain(
      'backdrop-filter: url("#hp-liquid-glass-distortion") blur(20px) saturate(1.22)',
    )
    expect(liquidSurface).toContain("opacity: 0.95")
    expect(cssRule(".hp-liquid-glass-enabled .glass-distortion-surface--subtle::before")).toContain(
      "opacity: 0.60",
    )
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

  it("turns off the refracted shadow-field motion in reduced-motion mode", () => {
    const reducedMotionBlock = globalsCss.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]+?)\n\s*\}\n\}/,
    )

    expect(reducedMotionBlock?.[1]).toContain(".hp-refracted-shadow-card__shadow")
    expect(reducedMotionBlock?.[1]).toContain("animation: none")
    expect(reducedMotionBlock?.[1]).toContain("transform: none")
  })
})
