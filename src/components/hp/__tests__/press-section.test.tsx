// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"
import { PRESS_CATEGORIES, PressDialog } from "@/components/hp/press-section"

describe("PressSection", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders the profile trigger as an icon-only social badge", () => {
    render(<PressDialog />)

    const trigger = screen.getByRole("button", { name: "実績" })

    expect(trigger).toHaveClass("glass-btn--profile-social")
    expect(trigger).toHaveAttribute("title", "実績")
    expect(trigger).not.toHaveTextContent("実績")
    expect(trigger).toHaveClass("w-[4.5rem]")

    const icons = Array.from(trigger.querySelectorAll("svg"))
    expect(icons).toHaveLength(2)
    expect(icons[0]).toHaveAttribute("fill", "currentColor")
    expect(icons[1]).toHaveAttribute("fill", "currentColor")
  })

  it("uses the popover token for the dialog entry transition", () => {
    const globalsCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")

    expect(globalsCss).toContain(".press-dialog-surface")
    expect(globalsCss).toContain("--motion-duration-popover")
    expect(globalsCss).toContain("transform: scale(0.97)")
    expect(globalsCss).toContain("@starting-style")
  })

  it("opens the three SSOT categories and nine press items in a modal dialog", () => {
    render(<PressDialog />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "実績" }))

    const dialog = screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })

    expect(within(dialog).getByRole("heading", { name: "登壇・メディア掲載 / 実績" })).toBeInTheDocument()
    expect(dialog.parentElement).toHaveStyle({
      zIndex: String(HP_MODAL_OVERLAY_Z_INDEX),
    })
    expect(PRESS_CATEGORIES.map((category) => category.title)).toEqual([
      "登壇・セミナー",
      "メディア掲載・事例紹介",
      "紹介動画制作",
    ])
    expect(PRESS_CATEGORIES.flatMap((category) => category.items)).toHaveLength(9)

    for (const category of PRESS_CATEGORIES) {
      expect(within(dialog).getByRole("heading", { name: category.title })).toBeInTheDocument()
      for (const item of category.items) {
        expect(within(dialog).getAllByText(item.period).length).toBeGreaterThan(0)
        expect(within(dialog).getByRole("heading", { name: item.title })).toBeInTheDocument()
        expect(within(dialog).getByText(item.description)).toBeInTheDocument()
      }
    }
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

  it("opens every external link in a new isolated tab", () => {
    render(<PressDialog />)
    fireEvent.click(screen.getByRole("button", { name: "実績" }))

    const dialog = screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })

    const expectedLinks = PRESS_CATEGORIES.flatMap((category) =>
      category.items.flatMap((item) =>
        item.links.map((link) => ({
          ...link,
          itemTitle: item.title,
        })),
      ),
    )

    for (const link of expectedLinks) {
      const anchor = within(dialog).getByRole("link", {
        name: `${link.itemTitle} ${link.label}を新しいタブで開く`,
      })

      expect(anchor).toHaveAttribute("href", link.href)
      expect(anchor).toHaveAttribute("target", "_blank")
      expect(anchor).toHaveAttribute("rel", "noopener noreferrer")
    }
  })

  it("closes with Escape and backdrop click", () => {
    render(<PressDialog />)

    fireEvent.click(screen.getByRole("button", { name: "実績" }))
    expect(screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "実績" }))
    const dialog = screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })
    fireEvent.mouseDown(dialog.parentElement!)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
