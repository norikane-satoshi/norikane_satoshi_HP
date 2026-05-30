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
    const neutralPlaceholders = container.querySelectorAll(
      "[data-featured-work-neutral-placeholder]",
    )

    expect(previewFrames).toHaveLength(embeddedWorkCount + 1)
    expect(cropFrames).toHaveLength(0)
    expect(scaledMedia).toHaveLength(0)
    expect(thumbnailCovers).toHaveLength(embeddedWorkCount + 1)
    expect(neutralPlaceholders).toHaveLength(0)
    expect(container.innerHTML).not.toContain("i.ytimg.com/vi/IQb3beIbE1I")

    const marsCard = screen.getByLabelText("火星の女王 代表作品カード")
    expect(marsCard.querySelector(".aspect-video")).toBeNull()
    expect(marsCard.querySelector('[data-featured-work-preview-media]')).toBeNull()
    expect(marsCard.querySelector("img")).toBeNull()

    for (const frame of previewFrames) {
      expect(frame).toHaveClass("aspect-video")
    }
  })

  it("pins video work badges to the preview frame bottom right", () => {
    const { container } = render(<FeaturedWorks />)

    const marsCard = screen.getByLabelText("火星の女王 代表作品カード")
    const marsBadges = marsCard.querySelector('[data-featured-work-link-badges="inline"]')
    expect(marsBadges).toBeInTheDocument()
    expect(marsBadges).toHaveClass("mt-4")
    expect(marsBadges).not.toHaveClass("absolute")

    const videoWorks = FEATURED_WORKS.filter((work) => work.youtubeId)
    for (const work of videoWorks) {
      const card = screen.getByLabelText(`${work.title} 代表作品カード`)
      const badges = card.querySelector('[data-featured-work-link-badges="overlay"]')
      expect(badges).toBeInTheDocument()
      expect(badges).toHaveClass("absolute")
      expect(badges).toHaveClass("bottom-2")
      expect(badges).toHaveClass("right-2")
      expect(badges).toHaveClass("justify-end")
      expect(badges).toHaveClass("z-30")
      expect(badges).not.toHaveClass("inset-x-2")
    }

    const badgeGroups = container.querySelectorAll("[data-featured-work-link-badges]")
    expect(badgeGroups).toHaveLength(FEATURED_WORKS.length)
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
