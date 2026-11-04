// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PRESS_CATEGORIES } from "@/components/hp/press-data"
import { PressList } from "@/components/hp/press-section"

function getLinkText(label: string, href: string) {
  if (!/^https?:\/\//.test(label)) return label
  const host = new URL(href).hostname.replace(/^www\./, "")
  return host === "web.archive.org" ? "web.archive.org（保存版）" : host
}

describe("PressList", () => {
  afterEach(() => {
    cleanup()
  })

  it("lists the three SSOT categories and every press item on the page", () => {
    render(<PressList />)

    expect(PRESS_CATEGORIES.map((category) => category.title)).toEqual([
      "登壇・セミナー",
      "メディア掲載・事例紹介",
      "紹介動画制作",
    ])
    expect(PRESS_CATEGORIES.flatMap((category) => category.items)).toHaveLength(10)

    for (const category of PRESS_CATEGORIES) {
      const section = screen.getByRole("region", { name: category.title })
      for (const item of category.items) {
        expect(within(section).getByRole("heading", { name: item.title })).toBeInTheDocument()
        expect(within(section).getByText(item.description)).toBeInTheDocument()
      }
    }
  })

  it("orders items in each category from newest to oldest", () => {
    render(<PressList />)

    const seminar = screen.getByRole("region", { name: "登壇・セミナー" })
    const periods = within(seminar)
      .getAllByRole("listitem")
      .map((item) => item.querySelector("p")?.textContent)

    expect(periods).toEqual(["2026年10月", "2025年5月", "2024年11月", "2024年11月", "2024年9月"])
  })

  it("keeps the Jukkakukan media item as one item with the two specified links", () => {
    const mediaItems =
      PRESS_CATEGORIES.find((category) => category.title === "メディア掲載・事例紹介")?.items ?? []
    const jukkakukan = mediaItems.find((item) => item.title.includes("十角館の殺人"))

    expect(jukkakukan).toEqual(
      expect.objectContaining({
        period: "2024年",
        links: [
          {
            label: "VIDEO SALON 記事",
            href: "https://videosalon.jp/report/jukkakukannosatsujin/",
          },
          {
            label: "Imagica EMS 事例紹介",
            href: "https://www.imagica-ems.co.jp/case-study/jukkakukannosatsujin_20240515/",
          },
        ],
      }),
    )
  })

  it("keeps the updated SSOT copy for trainer and Jukkakukan items", () => {
    const seminarItems =
      PRESS_CATEGORIES.find((category) => category.title === "登壇・セミナー")?.items ?? []
    const trainer = seminarItems.find((item) => item.title.includes("トレーニング講師"))
    const mediaItems =
      PRESS_CATEGORIES.find((category) => category.title === "メディア掲載・事例紹介")?.items ?? []
    const jukkakukan = mediaItems.find((item) => item.title.includes("十角館の殺人"))

    expect(trainer?.description).not.toContain("満席")
    expect(jukkakukan?.description).toContain("カラリストとして撮影現場")
    expect(jukkakukan?.description).not.toContain("DIカラリスト")
  })

  it("opens every external link in a new isolated tab and shows URL labels as the domain", () => {
    render(<PressList />)

    for (const category of PRESS_CATEGORIES) {
      for (const item of category.items) {
        for (const link of item.links) {
          const text = getLinkText(link.label, link.href)
          const anchor = screen.getByRole("link", {
            name: `${item.title} ${text}を新しいタブで開く`,
          })

          expect(anchor).toHaveAttribute("href", link.href)
          expect(anchor).toHaveAttribute("target", "_blank")
          expect(anchor).toHaveAttribute("rel", "noopener noreferrer")
          expect(anchor).toHaveTextContent(text)
        }
      }
    }
  })
})
