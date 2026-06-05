import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

function extractToken(css: string, token: string) {
  const match = css.match(new RegExp(`${token}:\\s*([^;]+);`))
  if (!match) {
    throw new Error(`Missing CSS token: ${token}`)
  }
  return match[1].trim()
}

function extractCssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`))
  if (!match) {
    throw new Error(`Missing CSS rule: ${selector}`)
  }
  return match[1]
}

function parseHexColor(color: string) {
  const match = color.match(/^#([0-9a-f]{6})$/i)
  if (!match) {
    throw new Error(`Expected 6-digit hex color, received: ${color}`)
  }
  const value = Number.parseInt(match[1], 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function parseRgbaColor(color: string) {
  const match = color.match(
    /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*(0(?:\.\d+)?|1(?:\.0+)?)\)$/i,
  )
  if (!match) {
    throw new Error(`Expected rgba() color, received: ${color}`)
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: Number(match[4]),
  }
}

function compositeOver(
  foreground: ReturnType<typeof parseRgbaColor>,
  background: ReturnType<typeof parseHexColor>,
) {
  return {
    r: Math.round(foreground.r * foreground.a + background.r * (1 - foreground.a)),
    g: Math.round(foreground.g * foreground.a + background.g * (1 - foreground.a)),
    b: Math.round(foreground.b * foreground.a + background.b * (1 - foreground.a)),
  }
}

function linearized(channel: number) {
  const normalized = channel / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: { r: number; g: number; b: number }) {
  return (
    0.2126 * linearized(color.r) +
    0.7152 * linearized(color.g) +
    0.0722 * linearized(color.b)
  )
}

function contrastRatio(
  foreground: { r: number; g: number; b: number },
  background: { r: number; g: number; b: number },
) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe("HP third-wave design contract", () => {
  it("loads Playfair Display as a latin-only --font-display variable", () => {
    const layout = readProjectFile("src/app/layout.tsx")

    expect(layout).toContain("Playfair_Display")
    expect(layout).toContain('variable: "--font-display"')
    expect(layout).toContain('subsets: ["latin"]')
    expect(layout).toContain('weight: ["400", "700"]')
    expect(layout).toContain('display: "swap"')
  })

  it("keeps --font-display scoped to the latin display utility for future localized copy", () => {
    const hero = readProjectFile("src/components/hp/hero-section.tsx")
    const page = readProjectFile("src/app/page.tsx")
    const nav = readProjectFile("src/components/hp/nav-header.tsx")
    const css = readProjectFile("src/app/globals.css")

    expect(css).toMatch(/\.hp-latin-display[\s\S]*font-family:\s*var\(--font-display\)/)
    expect(css).toMatch(/\.hp-latin-display[\s\S]*font-size:\s*clamp\(1\.75rem/)
    expect(hero).toContain("future English locale")
    expect(hero).not.toContain("hp-latin-display")
    expect(hero).not.toContain("Satoshi Norikane")
    expect(hero).not.toContain("Freelance Colorist")
    expect(hero).not.toMatch(/hp-latin-display[^>]+則兼|hp-latin-display[^>]+フリーランス/u)
    expect(page).not.toMatch(/hp-body[^"]*hp-latin-display|text-hp-muted[^"]*hp-latin-display/)
    expect(nav).not.toContain("hp-latin-display")
  })

  it("uses subdued cinematic page aurora tokens and keeps the bolder color field out of global chrome", () => {
    const css = readProjectFile("src/app/globals.css")

    expect(css).not.toContain("--accent-primary: #8B7FFF")
    expect(css).not.toContain("--aurora-red")
    expect(css).not.toContain("--aurora-blue")
    expect(css).not.toContain("--aurora-pink: rgba(255, 143, 171, 0.20)")
    expect(css).not.toContain("rgba(125, 211, 252")
    expect(extractToken(css, "--accent-primary")).toBe("#366FCC")
    expect(extractToken(css, "--aurora-purple")).toBe("rgba(93, 84, 171, 0.16)")
    expect(extractToken(css, "--aurora-pink")).toBe("rgba(178, 112, 150, 0.11)")
    expect(extractToken(css, "--aurora-sky")).toBe("rgba(106, 138, 172, 0.10)")

    for (const token of ["--aurora-purple", "--aurora-pink", "--aurora-sky"]) {
      expect(parseRgbaColor(extractToken(css, token)).a).toBeLessThanOrEqual(0.24)
    }
  })

  it("removes decorative high-saturation purple gradients from HP home source files", () => {
    const files = [
      "src/app/globals.css",
      "src/components/hp/featured-works.tsx",
      "src/components/hp/hero-section.tsx",
    ]

    for (const path of files) {
      const source = readProjectFile(path)
      expect(source).not.toContain("#C9BCFF")
      expect(source).not.toContain("#3B2A9E")
      expect(source).not.toContain("var(--accent-primary)_48%")
      expect(source).not.toContain("rgba(121,199,199,0.42)")
    }
  })

  it("keeps profile glass clean while lightweight dense surfaces stay separate", () => {
    const css = readProjectFile("src/app/globals.css")
    const page = readProjectFile("src/app/page.tsx")
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")
    const bookingCalendar = readProjectFile("src/components/booking/booking-calendar.tsx")
    const profileRule = extractCssRule(css, ".glass-card--hp-profile")

    expect(css).not.toContain(".glass-card--showcase")
    expect(profileRule).toContain("backdrop-filter: blur(34px) saturate(1.38)")
    expect(profileRule).toContain("inset 0 1px 0 rgba(255, 255, 255, 0.90)")
    expect(profileRule).toContain("0 14px 34px rgba(30, 34, 42, 0.085)")
    expect(profileRule).not.toContain("inset 12px")
    expect(profileRule).not.toContain("inset -12px")

    expect(page).toContain('className="glass-card glass-card--hp-profile')
    expect(page).not.toContain("glass-card--showcase")
    expect(page).toContain("className=\"group flex shrink-0 snap-start flex-col glass-card-sm")
    expect(featuredWorks).toContain("featured-work-transparent-card")
    expect(featuredWorks).not.toContain("className=\"group flex shrink-0 flex-col overflow-hidden glass-card-sm")
    expect(featuredWorks).not.toContain("glass-card--showcase")
    expect(bookingCalendar).not.toContain("glass-card--showcase")
    expect(bookingCalendar).toContain('className="booking-calendar__surface glass-flat"')
  })

  it("keeps canonical standard glass blur without preserving profile showcase layers", () => {
    const css = readProjectFile("src/app/globals.css")
    const glassCard = extractCssRule(css, ".glass-card")
    const glassCardSm = extractCssRule(css, ".glass-card-sm")
    const profileRule = extractCssRule(css, ".glass-card--hp-profile")

    expect(glassCard).toContain("backdrop-filter: blur(24px) saturate(1.2);")
    expect(glassCard).toContain("-webkit-backdrop-filter: blur(24px) saturate(1.2);")
    expect(glassCardSm).toContain("backdrop-filter: blur(12px);")
    expect(glassCardSm).toContain("-webkit-backdrop-filter: blur(12px);")
    expect(profileRule).toContain("backdrop-filter: blur(34px) saturate(1.38)")
    expect(css).not.toContain(".glass-card--showcase::before")
    expect(css).not.toContain(".glass-card--showcase::after")
  })

  it("keeps glass text colors at WCAG AA contrast on the standard glass surface", () => {
    const css = readProjectFile("src/app/globals.css")
    const bgBase = parseHexColor(extractToken(css, "--bg-base"))
    const glassBg = parseRgbaColor(extractToken(css, "--glass-bg"))
    const glassSurface = compositeOver(glassBg, bgBase)

    expect(contrastRatio(parseHexColor(extractToken(css, "--text-primary")), glassSurface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseHexColor(extractToken(css, "--text-muted")), glassSurface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseHexColor(extractToken(css, "--accent-primary")), glassSurface)).toBeGreaterThanOrEqual(3)
  })
})
