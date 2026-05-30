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

  it("crops each YouTube preview to a cinemascope frame", () => {
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

    const cropFrames = container.querySelectorAll(
      '[data-featured-work-preview-crop="cinemascope"]',
    )
    const scaledMedia = container.querySelectorAll(
      '[data-featured-work-preview-media="youtube-scale"]',
    )

    expect(cropFrames).toHaveLength(FEATURED_WORKS.length + 1)
    expect(scaledMedia).toHaveLength(FEATURED_WORKS.length + 1)

    for (const frame of cropFrames) {
      expect((frame as HTMLElement).style.aspectRatio).toBe("2.39 / 1")
      expect(frame).toHaveClass("overflow-hidden")
      expect(frame).not.toHaveClass("aspect-video")
    }

    for (const media of scaledMedia) {
      expect((media as HTMLElement).style.aspectRatio).toBe("16 / 9")
      expect((media as HTMLElement).style.transform).toBe(
        "translate(-50%, -50%) scale(2.2)",
      )
    }
  })
})
