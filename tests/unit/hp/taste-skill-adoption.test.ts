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
  if (!match) throw new Error(`Missing CSS token: ${token}`)
  return match[1].trim()
}

function extractCssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`))
  if (!match) throw new Error(`Missing CSS rule: ${selector}`)
  return match[1]
}

describe("HP taste-skill adoption contract", () => {
  afterEach(() => {
    cleanup()
  })

  it("preserves note routes and legacy homepage anchors", () => {
    const sitemap = readProjectFile("src/app/sitemap.ts")
    const page = readProjectFile("src/app/page.tsx")
    const nav = readProjectFile("src/components/hp/nav-header.tsx")
    const chatbot = readProjectFile("src/components/chatbot/widget/ChatbotWidget.tsx")

    expect(sitemap).toContain('"correction"')
    expect(sitemap).toContain('"grading"')
    expect(sitemap).toContain('"filmlook"')
    expect(page).toContain('id="profile"')
    expect(page).toContain('id="philosophy"')
    expect(page).toContain('id="contact"')
    expect(nav).toContain('/#profile')
    expect(nav).toContain('/#philosophy')
    expect(chatbot).toContain('CONTACT_HASH = "#contact"')
  })

  it("keeps the cinematic aurora glass invariants and rejects old neumorphism", () => {
    const css = readProjectFile("src/app/globals.css")
    const cssAndHome = [
      css,
      readProjectFile("src/components/hp/hero-section.tsx"),
      readProjectFile("src/app/page.tsx"),
    ].join("\n")

    expect(extractToken(css, "--accent-primary")).toBe("#7568D6")
    expect(extractToken(css, "--aurora-purple")).toBe("rgba(93, 84, 171, 0.16)")
    expect(extractCssRule(css, ".glass-card")).toContain("backdrop-filter: blur(24px) saturate(1.2);")
    expect(extractCssRule(css, ".glass-card-sm")).toContain("backdrop-filter: blur(12px);")
    expect(cssAndHome).not.toMatch(/--neu-|\\.neu-/)
  })

  it("keeps the default Japanese hero free of duplicate latin display headings", () => {
    render(React.createElement(HeroSection))

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("則兼 智志")
    expect(screen.getByText("フリーランスカラリスト")).toBeInTheDocument()
    expect(screen.queryByText(/Satoshi Norikane/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/Freelance Colorist/u)).not.toBeInTheDocument()
  })

  it("uses an editorial hero composition with a contact hash CTA", () => {
    render(React.createElement(HeroSection))

    expect(screen.getByText("映像の色で物語を翻訳する。")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /AI 相談窓口/u })).toHaveAttribute("href", "#contact")
    expect(screen.getByRole("link", { name: /ノートを読む/u })).toHaveAttribute("href", "/#philosophy")
  })
})
