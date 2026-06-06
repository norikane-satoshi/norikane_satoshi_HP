import { FEATURED_WORKS } from "@/components/hp/featured-works-data"

const featuredWorksLines = FEATURED_WORKS.map((work) => {
  const links = work.links.map((link) => `${link.label}: ${link.url}`).join(" / ")
  return `- ${work.title}（${work.client}） / 公式: ${work.officialUrl} / 掲載リンク: ${links}`
})

export const featuredWorksKnowledge = [
  "HP掲載のWorks/実績（公開済み情報のみ）。",
  "実績、作品、Works、ポートフォリオを聞かれたら、このHP掲載範囲では具体名を答えてよい。",
  "HPに掲載されていない案件名、取引先、担当範囲、件数、数値、進行中案件、非公開顧客情報は推測して出さず、本人確認へ誘導する。",
  ...featuredWorksLines,
  "- ライブ映像作品多数（配信）。",
].join("\n")
