import { describe, expect, it } from "vitest"

import {
  buildEmbedUrl,
  YOUTUBE_CROP_CLASSNAME,
  YOUTUBE_FRAME_STYLE,
} from "@/components/hp/featured-works-carousel"

describe("featured works YouTube preview configuration", () => {
  it("builds muted autoplay loop embed URLs from fixed YouTube ids", () => {
    const url = buildEmbedUrl("IQb3beIbE1I")

    expect(url).toContain("https://www.youtube-nocookie.com/embed/IQb3beIbE1I")
    expect(url).toContain("autoplay=1")
    expect(url).toContain("controls=0")
    expect(url).toContain("loop=1")
    expect(url).toContain("mute=1")
    expect(url).toContain("playlist=IQb3beIbE1I")
    expect(url).toContain("playsinline=1")
  })

  it("uses a fixed cinemascope crop container and centered scale transform", () => {
    expect(YOUTUBE_CROP_CLASSNAME).toContain("aspect-[239/100]")
    expect(YOUTUBE_CROP_CLASSNAME).toContain("overflow-hidden")
    expect(YOUTUBE_FRAME_STYLE.transform).toBe("translate(-50%, -50%) scale(1.36)")
  })
})
