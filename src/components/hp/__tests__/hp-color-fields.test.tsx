// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FeaturedWorks } from "@/components/hp/featured-works"
import {
  HERO_ABSTRACT_ART_BACKGROUND,
  HERO_DEEP_SURFACE_BACKGROUND,
  MARS_ABSTRACT_COVER_BACKGROUND,
} from "@/components/hp/hero-deep-surface"
import { HeroSection } from "@/components/hp/hero-section"

const globalsCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")

function readRgbaVariable(name: string) {
  const match = globalsCss.match(
    new RegExp(`${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([0-9.]+)\\)`),
  )
  expect(match, `${name} should be an rgba() CSS variable`).not.toBeNull()
  const [, r, g, b, a] = match as RegExpMatchArray
  return {
    alpha: Number(a),
    b: Number(b),
    g: Number(g),
    r: Number(r),
  }
}

function rgbDistance(
  first: { r: number; g: number; b: number },
  second: { r: number; g: number; b: number },
) {
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b)
}

describe("HP three-hue color fields", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the page aurora in subdued blue pink sky slots", () => {
    const purple = readRgbaVariable("--aurora-purple")
    const pink = readRgbaVariable("--aurora-pink")
    const sky = readRgbaVariable("--aurora-sky")

    expect(globalsCss).not.toContain("--aurora-red")
    expect(globalsCss).not.toContain("--aurora-blue")
    expect(globalsCss).toContain("var(--aurora-purple)")
    expect(globalsCss).toContain("var(--aurora-pink)")
    expect(globalsCss).toContain("var(--aurora-sky)")
    expect(globalsCss).toContain("at 15% 40%")
    expect(globalsCss).toContain("at 85% 15%")
    expect(globalsCss).toContain("at 55% 85%")

    expect(purple.alpha).toBe(0.16)
    expect(pink.alpha).toBe(0.11)
    expect(sky.alpha).toBe(0.10)
    expect(purple.alpha).toBeGreaterThan(pink.alpha)
    expect(pink.alpha).toBeGreaterThan(sky.alpha)

    expect(rgbDistance(purple, pink)).toBeGreaterThan(60)
    expect(rgbDistance(purple, sky)).toBeGreaterThan(25)
    expect(rgbDistance(pink, sky)).toBeGreaterThan(70)
  })

  it("keeps hero color fields pale, low-opacity, broad, and soft over the dark surface", () => {
    expect(HERO_DEEP_SURFACE_BACKGROUND).toContain("ellipse 72% 56%")
    expect(HERO_DEEP_SURFACE_BACKGROUND).toContain("rgba(245, 185, 214, 0.045)")
    expect(HERO_DEEP_SURFACE_BACKGROUND).toContain("rgba(232, 160, 166, 0.035)")
    expect(HERO_DEEP_SURFACE_BACKGROUND).toContain("rgba(174, 205, 236, 0.045)")
    expect(HERO_DEEP_SURFACE_BACKGROUND).toContain("#0E0E10")
    expect(HERO_ABSTRACT_ART_BACKGROUND).toContain("ellipse 70% 48%")
    expect(HERO_ABSTRACT_ART_BACKGROUND).toContain("rgba(248, 206, 226, 0.11)")
    expect(HERO_ABSTRACT_ART_BACKGROUND).toContain("rgba(238, 190, 194, 0.08)")
    expect(HERO_ABSTRACT_ART_BACKGROUND).toContain("rgba(196, 221, 244, 0.10)")
  })

  it("keeps the Mars cover cinematic and removes the section H color art", () => {
    expect(MARS_ABSTRACT_COVER_BACKGROUND).toContain("#101114")
    expect(MARS_ABSTRACT_COVER_BACKGROUND).toContain("#15161B")
    expect(MARS_ABSTRACT_COVER_BACKGROUND).not.toContain("224, 76, 140")
    expect(MARS_ABSTRACT_COVER_BACKGROUND).not.toContain("188, 60, 74")
    expect(MARS_ABSTRACT_COVER_BACKGROUND).not.toContain("54, 139, 214")
  })

  it("renders hero abstract art while keeping Mars and Featured Works card shells transparent", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        removeEventListener: vi.fn(),
      })),
    })

    const hero = render(<HeroSection />)
    const heroArt = hero.container.querySelector('[data-hp-abstract-art="hero"]')
    expect(heroArt).toBeInTheDocument()
    expect(heroArt?.querySelector("img")).toBeNull()
    expect(heroArt).toHaveAttribute("aria-hidden", "true")
    expect(heroArt).toHaveClass("blur-3xl")
    expect(heroArt).toHaveClass("opacity-55")
    hero.unmount()

    const works = render(<FeaturedWorks />)
    const marsCard = screen.getByLabelText("火星の女王 作品カード")
    const marsArt = marsCard.querySelector('[data-hp-abstract-art="mars"]')
    expect(marsArt).not.toBeInTheDocument()
    expect(marsCard.querySelector('[data-featured-work-abstract-cover="true"]')).toHaveAttribute(
      "data-hp-color-field",
      "cinematic-neutral",
    )
    expect(marsCard).toHaveClass("featured-work-transparent-card")
    expect(marsCard).not.toHaveClass("glass-card-sm")
    expect(marsCard).not.toHaveClass("glass-refraction-edge")
    expect(marsCard).not.toHaveClass("glass-distortion-surface")
    expect(screen.getByText("火星の女王")).toBeInTheDocument()
    expect(screen.getByText("NHK100周年記念ドラマ")).toBeInTheDocument()
    works.unmount()
  })
})
