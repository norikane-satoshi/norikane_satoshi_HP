// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FEATURED_WORKS } from "@/components/hp/featured-works-data"
import { FeaturedWorks } from "@/components/hp/featured-works"

describe("FeaturedWorks", () => {
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

  it("links each official work card to its official page", () => {
    render(<FeaturedWorks />)

    for (const work of FEATURED_WORKS) {
      expect(
        screen.getByRole("link", {
          name: `${work.title} 公式ページを新しいタブで開く`,
        }),
      ).toHaveAttribute("href", work.officialUrl)
    }
  })

  it("renders the live reel card without a link", () => {
    render(<FeaturedWorks />)

    expect(screen.getByLabelText("ライブ映像作品多数のランダムループ再生カード")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /ライブ映像作品多数/ })).not.toBeInTheDocument()
  })

  it("keeps each YouTube preview in a native 16:9 frame with a thumbnail cover", () => {
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

    expect(previewFrames).toHaveLength(FEATURED_WORKS.length + 1)
    expect(cropFrames).toHaveLength(0)
    expect(scaledMedia).toHaveLength(0)
    expect(thumbnailCovers).toHaveLength(FEATURED_WORKS.length + 1)

    for (const frame of previewFrames) {
      expect(frame).toHaveClass("aspect-video")
    }
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

    expect(preparingMedia).toHaveLength(FEATURED_WORKS.length + 1)
    expect(thumbnailCovers).toHaveLength(FEATURED_WORKS.length + 1)

    for (const media of preparingMedia) {
      expect(media).toHaveClass("pointer-events-none")
      expect(media).toHaveClass("opacity-0")
    }

    for (const thumbnail of thumbnailCovers) {
      expect(thumbnail).toHaveClass("opacity-100")
    }
  })
})
