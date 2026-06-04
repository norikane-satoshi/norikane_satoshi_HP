// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { HeroSection } from "@/components/hp/hero-section"

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

describe("HP cinematic color and spacing tokens", () => {
  afterEach(() => {
    cleanup()
  })

  it("uses cool slate body-muted text and a cool near-white base with AA contrast", () => {
    const css = readProjectFile("src/app/globals.css")
    const bgBase = extractToken(css, "--bg-base")
    const textMuted = extractToken(css, "--text-muted")
    const textMutedColor = parseHexColor(textMuted)
    const bgBaseColor = parseHexColor(bgBase)
    const glassSurface = compositeOver(parseRgbaColor(extractToken(css, "--glass-bg")), bgBaseColor)

    expect(textMuted).toBe("#5A6473")
    expect(bgBase).toBe("#F4F6F9")
    expect(contrastRatio(textMutedColor, bgBaseColor)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(textMutedColor, glassSurface)).toBeGreaterThanOrEqual(4.5)
  })

  it("keeps page aurora and primary accent tokens controlled while tightening body leading", () => {
    const css = readProjectFile("src/app/globals.css")
    const hpBody = extractCssRule(css, ".hp-body")
    const compactText = extractCssRule(css, ".hp-compact-text")
    const latinDisplay = extractCssRule(css, ".hp-latin-display")

    expect(extractToken(css, "--accent-primary")).toBe("#366FCC")
    expect(css).not.toContain("--aurora-red")
    expect(css).not.toContain("--aurora-blue")
    expect(extractToken(css, "--aurora-purple")).toBe("rgba(93, 84, 171, 0.16)")
    expect(extractToken(css, "--aurora-pink")).toBe("rgba(178, 112, 150, 0.11)")
    expect(extractToken(css, "--aurora-sky")).toBe("rgba(106, 138, 172, 0.10)")
    expect(hpBody).toContain("line-height: 1.7;")
    expect(hpBody).not.toContain("line-height: 1.85;")
    expect(compactText).toContain("line-height: 1.5;")
    expect(latinDisplay).toContain("line-height: 0.98;")
  })

  it("does not render duplicate latin display headings in the default Japanese hero", () => {
    render(React.createElement(HeroSection))

    expect(screen.getByText("則兼 智志")).toBeInTheDocument()
    expect(screen.getByText("フリーランスカラリスト")).toBeInTheDocument()
    expect(screen.getByText("東京・2026年〜")).toBeInTheDocument()
    expect(screen.queryByText(/Satoshi Norikane/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/Freelance Colorist/u)).not.toBeInTheDocument()
  })
})
