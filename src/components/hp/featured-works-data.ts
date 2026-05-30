export type FeaturedWork = {
  title: string
  client: string
  youtubeId?: string
  officialUrl: string
}

export const FEATURED_WORKS: FeaturedWork[] = [
  {
    title: "火星の女王",
    client: "NHK100周年記念ドラマ",
    officialUrl:
      "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pYElk2QVvW/",
  },
  {
    title: "十角館の殺人 / 時計館の殺人",
    client: "hulu",
    youtubeId: "-2kSMEiw0wA",
    officialUrl: "https://www.hulu.jp/static/tokeikannosatsujin/",
  },
  {
    title: "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
    client: "松竹配給",
    youtubeId: "aiPpSEcNLTk",
    officialUrl: "https://www.fukuyamamasaharu-livefilm.com/gekko/",
  },
  {
    title: "ゲキ×シネシリーズ",
    client: "ヴィレッヂ",
    youtubeId: "GiqkQel2CeU",
    officialUrl: "https://www.geki-cine.jp/",
  },
]

export const LIVE_REEL_VIDEO_IDS = [
  "fEYJazIPxUg",
  "G_3xr5desOo",
  "ZorB-2mqe-U",
  "d7qo_ke4kqI",
  "Nhv9GDVem5U",
] as const

export type ClipWindow = {
  startSeconds: number
  playSeconds: number
}

export function getYouTubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

export function shuffleVideoIds(
  videoIds: readonly string[],
  random: () => number = Math.random,
) {
  const shuffled = [...videoIds]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  return shuffled
}

export function calculateClipWindow(
  durationSeconds: number,
  random: () => number = Math.random,
  maxPlaySeconds = 30,
): ClipWindow {
  const safeDuration = Math.max(0, durationSeconds)
  if (safeDuration <= maxPlaySeconds) {
    return { startSeconds: 0, playSeconds: safeDuration }
  }

  const maxStart = safeDuration - maxPlaySeconds
  return {
    startSeconds: Math.floor(random() * (maxStart + 1)),
    playSeconds: maxPlaySeconds,
  }
}
