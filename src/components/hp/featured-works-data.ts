export type FeaturedWork = {
  title: string
  client: string
  youtubeId?: string
  loopStart?: number
  loopEnd?: number
  officialUrl: string
  links: FeaturedWorkLink[]
}

export type FeaturedWorkLink = {
  label: string
  url: string
}

export type FeaturedWorkPreviewVideo = {
  videoId: string
  loopStart?: number
  loopEnd?: number
}

export type FeaturedPlaylistWork = {
  title: string
  client?: string
  videos: readonly FeaturedWorkPreviewVideo[]
}

export const FEATURED_WORKS: FeaturedWork[] = [
  {
    title: "火星の女王",
    client: "NHK100周年記念ドラマ",
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
  },
  {
    title: "十角館の殺人 / 時計館の殺人",
    client: "hulu",
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
  },
  {
    title: "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
    client: "松竹配給",
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
  },
  {
    title: "ゲキ×シネシリーズ",
    client: "ヴィレッヂ",
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
  },
]

export const LIVE_REEL_VIDEOS = [
  { videoId: "fEYJazIPxUg" },
  { videoId: "G_3xr5desOo" },
  { videoId: "ZorB-2mqe-U" },
  { videoId: "d7qo_ke4kqI" },
  { videoId: "Nhv9GDVem5U" },
  { videoId: "heb1yJtreJg" },
  { videoId: "peWya9bxVXc", loopStart: 10, loopEnd: 40 },
  { videoId: "R92a65tojVg", loopStart: 0, loopEnd: 30 },
  { videoId: "y0g6UCE0Pzg", loopStart: 50, loopEnd: 80 },
  { videoId: "H_z2HYsx53o" },
] as const

export const LIVE_REEL_VIDEO_IDS = LIVE_REEL_VIDEOS.map((video) => video.videoId)

export const FEATURED_PLAYLIST_WORKS: FeaturedPlaylistWork[] = [
  {
    title: "ライブ映像作品",
    client: "配信",
    videos: LIVE_REEL_VIDEOS,
  },
  {
    title: "CM",
    videos: [
      { videoId: "Eo2IIH-w3h8" },
      { videoId: "fStjAoAOlbQ" },
      { videoId: "vchw9jvBntI" },
      { videoId: "cQwaCzcZNIk" },
    ],
  },
  {
    title: "MV",
    videos: [
      { videoId: "Pgvb6t2oLqg" },
      { videoId: "N7c7ZaVXjvk" },
      { videoId: "q5prKAR8UpA" },
      { videoId: "dbLARf2asG0" },
      { videoId: "QzQrzX07VMY" },
      { videoId: "EmjP3gJ_ALY" },
      { videoId: "6qZwQdw88Aw" },
      { videoId: "O8EynS4boVU" },
    ],
  },
]

export type ClipWindow = {
  startSeconds: number
  playSeconds: number
}

export function getYouTubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

export function shuffleVideoIds<T>(
  videoIds: readonly T[],
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
