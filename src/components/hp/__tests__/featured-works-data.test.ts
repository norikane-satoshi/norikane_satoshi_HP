import { describe, expect, it } from "vitest"
import {
  FEATURED_WORKS,
  LIVE_REEL_VIDEO_IDS,
  calculateClipWindow,
  shuffleVideoIds,
} from "@/components/hp/featured-works-data"

describe("featured works data", () => {
  it("defines the four official linked works with YouTube ids", () => {
    expect(FEATURED_WORKS).toEqual([
      expect.objectContaining({
        title: "火星の女王",
        officialUrl:
          "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pYElk2QVvW/",
      }),
      expect.objectContaining({
        title: "十角館の殺人 / 時計館の殺人",
        youtubeId: "-2kSMEiw0wA",
        officialUrl: "https://www.hulu.jp/static/tokeikannosatsujin/",
      }),
      expect.objectContaining({
        title: "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
        youtubeId: "aiPpSEcNLTk",
        officialUrl: "https://www.fukuyamamasaharu-livefilm.com/gekko/",
      }),
      expect.objectContaining({
        title: "ゲキ×シネシリーズ",
        youtubeId: "GiqkQel2CeU",
        officialUrl: "https://www.geki-cine.jp/",
      }),
    ])
    expect(FEATURED_WORKS[0]).not.toHaveProperty("youtubeId")
  })

  it("defines the five live reel YouTube ids", () => {
    expect(LIVE_REEL_VIDEO_IDS).toEqual([
      "fEYJazIPxUg",
      "G_3xr5desOo",
      "ZorB-2mqe-U",
      "d7qo_ke4kqI",
      "Nhv9GDVem5U",
    ])
  })

  it("shuffles ids without losing or adding entries", () => {
    const randomValues = [0.1, 0.7, 0.2, 0.9]
    const shuffled = shuffleVideoIds(LIVE_REEL_VIDEO_IDS, () => randomValues.shift() ?? 0)

    expect(shuffled).toHaveLength(LIVE_REEL_VIDEO_IDS.length)
    expect(new Set(shuffled)).toEqual(new Set(LIVE_REEL_VIDEO_IDS))
    expect(shuffled).not.toEqual(LIVE_REEL_VIDEO_IDS)
  })

  it("uses the full duration for videos up to 30 seconds", () => {
    expect(calculateClipWindow(24.5, () => 0.9)).toEqual({
      startSeconds: 0,
      playSeconds: 24.5,
    })
  })

  it("selects a random 30 second window for longer videos", () => {
    expect(calculateClipWindow(90, () => 0.5)).toEqual({
      startSeconds: 30,
      playSeconds: 30,
    })
  })
})
