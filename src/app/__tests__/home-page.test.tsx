// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import HomePage from "@/app/page"
import {
  DAVINCI_RESOLVE_TRAINER_TEXT,
  DAVINCI_RESOLVE_TRAINING_URL,
} from "@/lib/hp/davinci-trainer"
import { hpPublicContent } from "@/lib/hp/public-content"
import { listPublishedNotes } from "@/lib/notion/server/fetch-note"

vi.mock("@/components/hp/featured-works", () => ({
  FeaturedWorks: () => <div data-testid="featured-works" />,
}))

vi.mock("@/components/hp/hero-section", () => ({
  HeroSection: () => <section data-testid="hero-section" />,
}))

vi.mock("@/lib/notion/server/fetch-note", () => ({
  listPublishedNotes: vi.fn(async () => [
    {
      id: "note-correction",
      slug: "correction",
      title: "カラーコレクションとカラーグレーディングの違い",
      createdTime: "2026-01-01T00:00:00.000Z",
      lastEditedTime: "2026-01-01T00:00:00.000Z",
    },
  ]),
}))

describe("HomePage", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders the noir page with sections in works, notes, profile order", async () => {
    const { container } = render(await HomePage())

    const page = container.firstElementChild
    expect(page).toHaveAttribute("data-hp-theme", "noir")
    expect(
      Array.from(container.querySelectorAll("section[id]"), (section) => section.id),
    ).toEqual(["works", "philosophy", "profile"])
    expect(screen.getByTestId("featured-works")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Notes" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 2, name: "Talks & Press" })).not.toBeInTheDocument()
    expect(container.querySelector("#schedule")).not.toBeInTheDocument()
  })

  it("shows note cards with thumbnails, opening external articles in the same tab", async () => {
    const { container } = render(await HomePage())

    const cards = container.querySelectorAll("[data-hp-note-card]")
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card).toHaveClass("hp-note-card")
      expect(card.querySelector("img")).toBeInTheDocument()
      expect(card).not.toHaveAttribute("target")
    }
  })

  it("keeps the home page available when the external notes query fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(listPublishedNotes).mockRejectedValueOnce(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      }),
    )

    render(await HomePage())

    expect(screen.getByTestId("hero-section")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledWith("[HP_HOME_NOTES_FETCH_FAILED]", {
      event: "hp_home_notes_fetch_failed",
      errorName: "TypeError",
      causeName: "Error",
      causeCode: "ECONNRESET",
    })
    consoleError.mockRestore()
  })

  it("lists every career entry and the profile links", async () => {
    render(await HomePage())

    const profile = document.getElementById("profile") as HTMLElement
    for (const item of hpPublicContent.profile.timeline) {
      expect(within(profile).getByRole("heading", { name: item.event })).toBeInTheDocument()
      expect(within(profile).getByText(item.detail)).toBeInTheDocument()
    }
    expect(within(profile).getByText(hpPublicContent.profile.title)).toBeInTheDocument()
    for (const { label, href } of hpPublicContent.profile.socialLinks) {
      expect(within(profile).getByRole("link", { name: label })).toHaveAttribute("href", href)
    }
    expect(within(profile).getByRole("button", { name: "登壇・掲載" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    )
    expect(
      within(profile).getByRole("button", { name: "プロフィール写真を拡大表示" }),
    ).toBeInTheDocument()
  })

  it("renders the DaVinci Resolve certified trainer intro text as a direct official link", async () => {
    const { container } = render(await HomePage())

    const intro = container.querySelector(".hp-intro-text") as HTMLElement
    expect(intro).toHaveTextContent(hpPublicContent.intro)

    const officialLink = within(intro).getByRole("link", { name: DAVINCI_RESOLVE_TRAINER_TEXT })
    expect(officialLink).toHaveAttribute(
      "href",
      "https://www.blackmagicdesign.com/jp/products/davinciresolve/training#partners",
    )
    expect(new URL(DAVINCI_RESOLVE_TRAINING_URL).search).toBe("")
    expect(officialLink).toHaveAttribute("target", "_blank")
    expect(officialLink).toHaveAttribute("rel", "noopener noreferrer")
  })
})
