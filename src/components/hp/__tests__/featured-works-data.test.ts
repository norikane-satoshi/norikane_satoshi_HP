import { describe, expect, it } from "vitest"
import {
  FEATURED_WORKS,
  LIVE_REEL_VIDEO_IDS,
  calculateClipWindow,
  shuffleVideoIds,
} from "@/components/hp/featured-works-data"

describe("featured works data", () => {
  it("defines the five official linked works with YouTube ids", () => {
    expect(FEATURED_WORKS).toEqual([
      expect.objectContaining({
        title: "火星の女王",
        officialUrl:
          "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pYElk2QVvW/",
        links: [
          {
            label: "作品HP",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=IQb3beIbE1I",
          },
          {
            label: "ショット集1",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pYElk2QVvW/",
          },
          {
            label: "2",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pXy8Aa9ab2/",
          },
          {
            label: "3",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pZKwLbXAbZ/",
          },
        ],
      }),
      expect.objectContaining({
        title: "十角館の殺人 / 時計館の殺人",
        youtubeId: "-2kSMEiw0wA",
        officialUrl: "https://www.hulu.jp/static/tokeikannosatsujin/",
        links: [
          {
            label: "公式HP",
            url: "https://www.hulu.jp/static/tokeikannosatsujin/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=-2kSMEiw0wA",
          },
        ],
      }),
      expect.objectContaining({
        title: "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
        youtubeId: "aiPpSEcNLTk",
        officialUrl: "https://www.fukuyamamasaharu-livefilm.com/gekko/",
        links: [
          {
            label: "公式HP",
            url: "https://www.fukuyamamasaharu-livefilm.com/gekko/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=aiPpSEcNLTk",
          },
        ],
      }),
      expect.objectContaining({
        title: "ゲキ×シネシリーズ",
        youtubeId: "GiqkQel2CeU",
        officialUrl: "https://www.geki-cine.jp/",
        links: [
          {
            label: "公式HP",
            url: "https://www.geki-cine.jp/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=GiqkQel2CeU",
          },
        ],
      }),
      expect.objectContaining({
        title: "リラックマと遊園地",
        client: "NETFLIX",
        youtubeId: "-X5BMqt0m2c",
        officialUrl: "https://www.san-x.co.jp/rilakkuma/theme_park_adventure/",
        links: [
          {
            label: "公式HP",
            url: "https://www.san-x.co.jp/rilakkuma/theme_park_adventure/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=-X5BMqt0m2c",
          },
        ],
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
