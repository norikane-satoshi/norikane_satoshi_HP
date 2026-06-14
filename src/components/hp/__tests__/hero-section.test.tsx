// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HeroSection } from "@/components/hp/hero-section"

describe("HeroSection copy", () => {
  it("renders only the master hero copy", () => {
    const { container } = render(<HeroSection />)

    const masterCopy = [
      "デモリール準備中",
      "則兼 智志",
      "フリーランスカラリスト",
      "東京・2026年〜",
    ]
    const removedCopy = [
      "Color Grading / Look Design",
      "映像の色で物語を翻訳する。",
      "作品の意図を読み、色設計から納品まで静かに整えるカラリストです。",
      "AI 相談窓口",
      "ノートを読む",
      "DaVinci Resolve / ACES",
      "劇場映画・配信・CM・MV",
      "Remote / Studio",
      "立ち会い・リモート両対応",
    ]

    for (const text of masterCopy) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }

    for (const text of removedCopy) {
      expect(container).not.toHaveTextContent(text)
    }
  })
})
