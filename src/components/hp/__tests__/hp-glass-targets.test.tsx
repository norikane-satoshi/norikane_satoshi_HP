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

describe("HP targeted glass contracts", () => {
  it("targets notes profile and schedule glass without broadening Featured Works", () => {
    expect(pageSource).toContain(
      "glass-card-sm glass-card-sm--hp-note glass-refraction-edge glass-distortion-surface",
    )
    expect(pageSource).toContain(
      "glass-card glass-card--showcase glass-card--hp-profile glass-distortion-surface",
    )
    expect(homeScheduleSource).toContain("glass-card glass-card--hp-schedule")
    expect(calendarEmbedSource).toContain("glass-inset glass-inset--hp-schedule")

    expect(cssRule(".glass-card-sm--hp-note")).toContain("saturate(1.42)")
    expect(cssRule(".glass-card--hp-profile")).toContain("blur(34px)")
    expect(cssRule(".glass-card--hp-schedule")).toContain("blur(30px)")
    expect(cssRule(".glass-inset--hp-schedule")).toContain("inset")
    expect(cssRule(".featured-work-transparent-card")).toContain(
      "backdrop-filter: none",
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
})
