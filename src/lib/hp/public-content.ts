import type {AppLocale} from "@/i18n/routing"

const jaContent = {
  hero: {
    name: "則兼 智志",
    title: "フリーランスカラリスト",
    locationLine: "東京・2026年〜",
  },
  intro:
    "フリーランスカラリストとして、劇場映画・配信作品・CM・ブランドフィルムのカラーグレーディングを承っています。立ち会い対応・リモート対応どちらも可能です。プロジェクトの規模・スケジュール・納品仕様に合わせた柔軟なワークフローでご提案いたします。DaVinci Resolve 認定トレーナーとして講義、講習会のご依頼も承ってます。",
  profile: {
    sectionTitle: "プロフィール",
    name: "則兼 智志",
    title: "フリーランスカラリスト",
    tools: [
      "DaVinci Resolve",
      "Premiere Pro",
      "After Effects",
      "Photoshop",
    ],
    socialLinks: [
      { label: "X", href: "https://x.com/norikanesatoshi" },
      { label: "YouTube", href: "https://www.youtube.com/@norikanesatoshi" },
      {
        label: "Instagram",
        href: "https://www.instagram.com/satoshi_norikane_colorist/",
      },
    ],
    timeline: [
      {
        year: "2013",
        event: "IMAGICA 入社",
        detail:
          "静岡文化芸術大学デザイン学部卒業後、IMAGICA にてカラリストアシスタントとしてキャリアをスタート。フィルムテレシネ業務を経て、DaVinci Resolve によるグレーディング技術を習得。",
      },
      {
        year: "2018",
        event: "メインカラリスト",
        detail:
          "劇場映画・配信作品・CM・MVのカラーグレーディングを担当。DaVinci Resolve によるオンラインエディット・VFX 連携のサービスを立ち上げ、部署全体に新ワークフローを展開。ACES ワークフローによるカラーマネジメントを専門に。DaVinci Resolve 認定トレーナーとして、テレビ局や Blackmagic Design 本社での講義活動も行う。",
      },
      {
        year: "2023",
        event: "バーチャルプロダクション カラークリエイター兼任",
        detail:
          "LED ウォールを用いた撮影現場でのオンセットカラーマネジメントを担当。異なるソース間のカラーを統一し、CG 素材・LED 背景と実写素材の自然な馴染ませを実現。",
      },
      {
        year: "2026",
        event: "独立開業",
        detail:
          "のりかね映像設計室（Norikane Film Design Office）として独立。カラーグレーディングの体系化と教育にも取り組む。",
      },
    ],
  },
} as const

const enContent = {
  hero: {
    name: "Satoshi Norikane",
    title: "Freelance Colorist",
    locationLine: "Tokyo · Independent since 2026",
  },
  intro:
    "I provide color grading for theatrical films, streaming productions, commercials, and brand films. Both attended and remote sessions are available, with a flexible workflow tailored to each project's scale, schedule, and delivery requirements. I also accept requests for lectures and workshops as a DaVinci Resolve Certified Trainer.",
  profile: {
    sectionTitle: "Profile",
    name: "Satoshi Norikane",
    title: "Freelance Colorist",
    tools: jaContent.profile.tools,
    socialLinks: jaContent.profile.socialLinks,
    timeline: [
      {
        year: "2013",
        event: "Joined IMAGICA",
        detail:
          "After graduating from the Faculty of Design at Shizuoka University of Art and Culture, I began my career at IMAGICA as a colorist assistant. Following film telecine work, I developed my grading practice with DaVinci Resolve.",
      },
      {
        year: "2018",
        event: "Lead Colorist",
        detail:
          "I graded theatrical films, streaming productions, commercials, and music videos. I launched an online-editing and VFX collaboration service built around DaVinci Resolve and introduced the workflow across the department, specializing in ACES color management. As a DaVinci Resolve Certified Trainer, I also taught at broadcasters and Blackmagic Design's headquarters.",
      },
      {
        year: "2023",
        event: "Virtual Production Color Creator",
        detail:
          "Alongside grading, I managed on-set color for LED-wall productions, matching color across different sources and integrating CG, LED backgrounds, and live-action footage naturally.",
      },
      {
        year: "2026",
        event: "Founded an independent studio",
        detail:
          "I established Norikane Film Design Office, continuing to develop structured color-grading methods and education alongside production work.",
      },
    ],
  },
} as const

export const hpPublicContent = jaContent

export function getHpPublicContent(locale: AppLocale) {
  return locale === "en" ? enContent : jaContent
}

export type HpPublicContent = ReturnType<typeof getHpPublicContent>
