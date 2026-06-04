// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { HeroSection } from "@/components/hp/hero-section"

const root = process.cwd()
const masterCopyCommit = "840ead054d610be921340fff2bbe5d6b1d29468a"
const visibleEnglishLiterals = new Set([
  "Career",
  "DaVinci Resolve",
  "Featured Works",
  "Instagram",
  "NETFLIX",
  "NHK100周年記念ドラマ",
  "Norikane Film Design Office",
  "Note",
  "Notes",
  "Photoshop",
  "Premiere Pro",
  "Profile",
  "YouTube",
  "X",
])

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

function readMasterFile(path: string) {
  return execFileSync("git", ["show", `${masterCopyCommit}:${path}`], {
    cwd: root,
    encoding: "utf8",
  })
}

function extractVisibleCopy(source: string) {
  return [...source.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
    .map((match) => match[2])
    .filter((literal) => !literal.includes("${"))
    .filter((literal) => {
      return (
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(literal) ||
        visibleEnglishLiterals.has(literal)
      )
    })
    .sort()
}

function expectVisibleCopyToMatchMaster(path: string) {
  expect(extractVisibleCopy(readProjectFile(path))).toEqual(
    extractVisibleCopy(readMasterFile(path)),
  )
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

    expect(screen.getByText("則兼 智志")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("フリーランスカラリスト")
    expect(screen.queryByText(/Satoshi Norikane/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/Freelance Colorist/u)).not.toBeInTheDocument()
  })

  it("keeps the hero copy aligned to master", () => {
    const { container } = render(React.createElement(HeroSection))

    for (const text of [
      "デモリール準備中",
      "則兼 智志",
      "フリーランスカラリスト",
      "東京・2026年〜",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }

    for (const text of [
      "Color Grading / Look Design",
      "映像の色で物語を翻訳する。",
      "作品の意図を読み、色設計から納品まで静かに整えるカラリストです。",
      "AI 相談窓口",
      "ノートを読む",
      "DaVinci Resolve / ACES",
      "劇場映画・配信・CM・MV",
      "Remote / Studio",
      "立ち会い・リモート両対応",
    ]) {
      expect(container).not.toHaveTextContent(text)
    }
  })

  it("keeps public homepage visible copy locked to master while UI changes", () => {
    for (const path of [
      "src/app/page.tsx",
      "src/components/hp/hero-section.tsx",
      "src/components/hp/nav-header.tsx",
      "src/components/hp/featured-works-data.ts",
      "src/lib/site-brand.ts",
    ]) {
      expectVisibleCopyToMatchMaster(path)
    }

    const page = readProjectFile("src/app/page.tsx")
    expect(page).toContain("hp-visual-redesign")
  })

  it("keeps public note page copy locked to master", () => {
    for (const path of [
      "src/app/notes/[slug]/page.tsx",
      "article-correction.md",
      "article-grading.md",
      "article-filmlook.md",
    ]) {
      expectVisibleCopyToMatchMaster(path)
    }
  })
})
