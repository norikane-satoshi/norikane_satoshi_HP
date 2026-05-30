// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FEATURED_WORKS } from "@/components/hp/featured-works-data"
import { FeaturedWorks } from "@/components/hp/featured-works"

describe("FeaturedWorks", () => {
  const embeddedWorkCount = FEATURED_WORKS.filter((work) => work.youtubeId).length

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders non-navigating work cards with only badge links", () => {
    render(<FeaturedWorks />)

    for (const work of FEATURED_WORKS) {
      const card = screen.getByLabelText(`${work.title} 代表作品カード`)
      expect(card).toBeInTheDocument()
      expect(card.tagName).toBe("DIV")
      expect(card).not.toHaveAttribute("href")

      for (const link of work.links) {
        const badge = screen.getByRole("link", {
          name: `${work.title} ${link.label}を新しいタブで開く`,
        })
        expect(badge).toHaveAttribute("href", link.url)
        expect(badge).toHaveAttribute("target", "_blank")
        expect(badge).toHaveAttribute("rel", "noopener noreferrer")
      }
    }
  })

  it("renders the live reel card without badge links", () => {
    render(<FeaturedWorks />)

    expect(screen.getByLabelText("ライブ映像作品多数のランダムループ再生カード")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /ライブ映像作品多数/ })).not.toBeInTheDocument()
  })

  it("keeps each preview in a native 16:9 frame with safe covers", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { container } = render(<FeaturedWorks />)

    const previewFrames = container.querySelectorAll(".aspect-video")
    const cropFrames = container.querySelectorAll("[data-featured-work-preview-crop]")
    const scaledMedia = container.querySelectorAll(
      '[data-featured-work-preview-media="youtube-scale"]',
    )
    const thumbnailCovers = container.querySelectorAll(
      '[data-featured-work-preview-thumbnail="visible"]',
    )
    const mediaCovers = container.querySelectorAll("[data-featured-work-preview-media]")
    const abstractCovers = container.querySelectorAll(
      '[data-featured-work-abstract-cover="true"]',
    )
    const neutralPlaceholders = container.querySelectorAll(
      "[data-featured-work-neutral-placeholder]",
    )

    expect(previewFrames).toHaveLength(embeddedWorkCount + 2)
    expect(abstractCovers).toHaveLength(1)
    expect(cropFrames).toHaveLength(0)
    expect(scaledMedia).toHaveLength(0)
    expect(thumbnailCovers).toHaveLength(embeddedWorkCount + 1)
    expect(mediaCovers).toHaveLength(embeddedWorkCount + 1)
    expect(neutralPlaceholders).toHaveLength(0)
    expect(container.innerHTML).not.toContain("i.ytimg.com/vi/IQb3beIbE1I")

    const marsCard = screen.getByLabelText("火星の女王 代表作品カード")
    const marsFrame = marsCard.querySelector('[data-featured-work-abstract-cover="true"]')
    expect(marsFrame).toHaveClass("aspect-video")
    expect(marsCard.querySelector('[data-featured-work-preview-media]')).toBeNull()
    expect(marsCard.querySelector("img")).toBeNull()

    for (const frame of previewFrames) {
      expect(frame).toHaveClass("aspect-video")
      expect(frame).toHaveClass("overflow-hidden")
      expect(frame).toHaveClass("-mt-4")
      expect(frame).toHaveClass("-mx-4")
      expect(frame).toHaveClass("rounded-t-[12px]")
      expect(frame).not.toHaveClass("rounded-[12px]")
      expect(frame).not.toHaveClass("border")
      expect(frame).not.toHaveClass("bg-white/35")
    }

    for (const thumbnail of thumbnailCovers) {
      expect(thumbnail).toHaveClass("rounded-none")
      expect(thumbnail).not.toHaveClass("rounded-[12px]")
    }

    for (const media of mediaCovers) {
      expect(media).toHaveClass("rounded-none")
      expect(media).not.toHaveClass("rounded-[12px]")
    }

    for (const work of FEATURED_WORKS) {
      expect(screen.getByLabelText(`${work.title} 代表作品カード`)).toHaveClass(
        "overflow-hidden",
      )
    }
    expect(screen.getByLabelText("ライブ映像作品多数のランダムループ再生カード")).toHaveClass(
      "overflow-hidden",
    )
  })

  it("places video work badge groups inline with clients", () => {
    const { container } = render(<FeaturedWorks />)

    for (const work of FEATURED_WORKS.filter((item) => item.youtubeId)) {
      const card = screen.getByLabelText(`${work.title} 代表作品カード`)
      const badges = card.querySelector('[data-featured-work-link-badges="inline"]')
      expect(badges).toBeInTheDocument()
      expect(badges).toHaveClass("flex")
      expect(badges).toHaveClass("justify-end")
      expect(badges).not.toHaveClass("absolute")
      expect(badges).not.toHaveClass("mt-3")
      expect(badges).not.toHaveClass("bottom-2")
      expect(badges).not.toHaveClass("right-2")
      expect(badges).not.toHaveClass("z-30")

      const title = Array.from(card.querySelectorAll("p")).find(
        (element) => element.textContent === work.title,
      )
      const client = Array.from(card.querySelectorAll("p")).find(
        (element) => element.textContent === work.client,
      )
      const metaRow = title?.nextElementSibling
      expect(title).toBeInTheDocument()
      expect(client).toBeInTheDocument()
      expect(metaRow).toBe(client?.parentElement)
      expect(badges?.parentElement).toBe(client?.parentElement)
      expect(metaRow).toHaveClass("mt-auto")
      expect(metaRow).toHaveClass("flex")
    }

    const badgeGroups = container.querySelectorAll("[data-featured-work-link-badges]")
    expect(badgeGroups).toHaveLength(FEATURED_WORKS.length)
    expect(
      screen
        .getByLabelText("ライブ映像作品多数のランダムループ再生カード")
        .querySelector("[data-featured-work-link-badges]"),
    ).toBeNull()
  })

  it("places Mars badges inside an abstract cover without media", () => {
    const { container } = render(<FeaturedWorks />)
    const mars = FEATURED_WORKS.find((work) => work.title === "火星の女王")
    expect(mars).toBeDefined()

    const card = screen.getByLabelText("火星の女王 代表作品カード")
    const abstractCover = card.querySelector(
      '[data-featured-work-abstract-cover="true"]',
    )
    const badges = abstractCover?.querySelector(
      '[data-featured-work-link-badges="inline"]',
    )
    const title = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === "火星の女王",
    )
    const client = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === mars?.client,
    )
    const metaRow = title?.nextElementSibling

    expect(abstractCover).toHaveClass("aspect-video")
    expect(abstractCover).toHaveClass("overflow-hidden")
    expect(abstractCover).toHaveClass("-mt-4")
    expect(abstractCover).toHaveClass("-mx-4")
    expect(abstractCover).toHaveClass("rounded-t-[12px]")
    expect(abstractCover?.querySelector("img")).toBeNull()
    expect(abstractCover?.querySelector('[data-featured-work-preview-media]')).toBeNull()
    expect(abstractCover?.querySelector("iframe")).toBeNull()
    expect(badges).toBeInTheDocument()
    expect(title).toBeInTheDocument()
    expect(abstractCover?.nextElementSibling).toBe(title)
    expect(client).toBeInTheDocument()
    expect(metaRow).toBe(client?.parentElement)
    expect(metaRow?.querySelector("[data-featured-work-link-badges]")).toBeNull()

    for (const link of mars?.links ?? []) {
      const badge = abstractCover?.querySelector(
        `[data-featured-work-link-badge="${link.label}"]`,
      )
      expect(badge).toHaveAttribute("href", link.url)
      expect(badge).toHaveAttribute("target", "_blank")
      expect(badge).toHaveAttribute("rel", "noopener noreferrer")
      expect(badge).toHaveAttribute(
        "aria-label",
        `火星の女王 ${link.label}を新しいタブで開く`,
      )
    }

    expect(
      container.querySelectorAll('[data-featured-work-abstract-cover="true"]'),
    ).toHaveLength(1)
  })

  it("renders Rilakkuma as a playable Netflix video card with inline badges", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(<FeaturedWorks />)

    const card = screen.getByLabelText("リラックマと遊園地 代表作品カード")
    const title = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === "リラックマと遊園地",
    )
    const client = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === "NETFLIX",
    )
    const frame = card.querySelector(".aspect-video")
    const thumbnail = card.querySelector(
      '[data-featured-work-preview-thumbnail="visible"]',
    )
    const media = card.querySelector('[data-featured-work-preview-media="preparing"]')
    const badges = card.querySelector('[data-featured-work-link-badges="inline"]')

    expect(card.tagName).toBe("DIV")
    expect(card).not.toHaveAttribute("href")
    expect(frame).toHaveClass("aspect-video")
    expect(frame).toHaveClass("overflow-hidden")
    expect(frame).toHaveClass("-mt-4")
    expect(frame).toHaveClass("-mx-4")
    expect(frame).toHaveClass("rounded-t-[12px]")
    expect(thumbnail).toBeInTheDocument()
    expect(thumbnail).toHaveClass("rounded-none")
    expect(media).toBeInTheDocument()
    expect(media).toHaveClass("rounded-none")
    expect(title).toBeInTheDocument()
    expect(client).toBeInTheDocument()
    expect(title?.nextElementSibling).toBe(client?.parentElement)
    expect(badges?.parentElement).toBe(client?.parentElement)

    expect(
      screen.getByRole("link", {
        name: "リラックマと遊園地 公式HPを新しいタブで開く",
      }),
    ).toHaveAttribute(
      "href",
      "https://www.san-x.co.jp/rilakkuma/theme_park_adventure/",
    )
    expect(
      screen.getByRole("link", {
        name: "リラックマと遊園地 YouTubeを新しいタブで開く",
      }),
    ).toHaveAttribute("href", "https://www.youtube.com/watch?v=-X5BMqt0m2c")
  })

  it("prepares YouTube API players behind thumbnail covers", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { container } = render(<FeaturedWorks />)

    const preparingMedia = container.querySelectorAll(
      '[data-featured-work-preview-media="preparing"]',
    )
    const thumbnailCovers = container.querySelectorAll(
      '[data-featured-work-preview-thumbnail="visible"]',
    )

    expect(preparingMedia).toHaveLength(embeddedWorkCount + 1)
    expect(thumbnailCovers).toHaveLength(embeddedWorkCount + 1)

    for (const media of preparingMedia) {
      expect(media).toHaveClass("pointer-events-none")
      expect(media).toHaveClass("opacity-0")
    }

    for (const thumbnail of thumbnailCovers) {
      expect(thumbnail).toHaveClass("opacity-100")
    }
  })
})
