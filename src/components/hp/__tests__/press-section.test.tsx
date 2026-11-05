// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PRESS_CATEGORIES } from "@/components/hp/press-data"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"
import { PressDialog } from "@/components/hp/press-section"

function getLinkText(label: string, href: string) {
  if (!/^https?:\/\//.test(label)) return label
  const host = new URL(href).hostname.replace(/^www\./, "")
  return host === "web.archive.org" ? "web.archive.org（保存版）" : host
}

function openDialog() {
  render(<PressDialog />)
  fireEvent.click(screen.getByRole("button", { name: "登壇・掲載" }))
  return screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })
}

describe("PressDialog", () => {
  afterEach(() => {
    cleanup()
  })

  it("keeps the list closed until the profile button opens it in a noir modal", () => {
    render(<PressDialog />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    const trigger = screen.getByRole("button", { name: "登壇・掲載" })
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    fireEvent.click(trigger)

    const dialog = screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(dialog.parentElement).toHaveStyle({ zIndex: String(HP_MODAL_OVERLAY_Z_INDEX) })
  })

  it("closes with Escape and backdrop click", () => {
    const dialog = openDialog()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "登壇・掲載" }))
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!)
    expect(dialog).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens from the #press hash used by the navigation", () => {
    window.location.hash = "#press"
    render(<PressDialog />)
    expect(screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })).toBeInTheDocument()
    cleanup()
    expect(window.location.hash).toBe("")
  })

  it("lists the three SSOT categories and every press item", () => {
    const dialog = openDialog()

    expect(PRESS_CATEGORIES.map((category) => category.title)).toEqual([
      "登壇・セミナー",
      "メディア掲載・事例紹介",
      "紹介動画制作",
    ])
    expect(PRESS_CATEGORIES.flatMap((category) => category.items)).toHaveLength(10)

    for (const category of PRESS_CATEGORIES) {
      const section = within(dialog).getByRole("region", { name: category.title })
      for (const item of category.items) {
        expect(within(section).getByRole("heading", { name: item.title })).toBeInTheDocument()
        expect(within(section).getByText(item.description)).toBeInTheDocument()
      }
    }
  })

  it("orders items in each category from newest to oldest", () => {
    const dialog = openDialog()

    const seminar = within(dialog).getByRole("region", { name: "登壇・セミナー" })
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
    const dialog = openDialog()

    for (const category of PRESS_CATEGORIES) {
      for (const item of category.items) {
        for (const link of item.links) {
          const text = getLinkText(link.label, link.href)
          const anchor = within(dialog).getByRole("link", {
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
