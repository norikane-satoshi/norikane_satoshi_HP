import { FEATURED_WORKS } from "@/components/hp/featured-works-data"
import { PRESS_CATEGORIES } from "@/components/hp/press-data"
import { hpPublicContent } from "@/lib/hp/public-content"
import { publishedNotesSnapshot } from "@/lib/chatbot/knowledge/published-notes-snapshot"

const serviceLines = [
  `- ヒーロー: ${hpPublicContent.hero.name} / ${hpPublicContent.hero.title} / ${hpPublicContent.hero.locationLine}`,
  `- トップ導入文: ${hpPublicContent.intro}`,
  "- サービス紹介: 劇場映画・配信作品・CM・ブランドフィルムのカラーグレーディング。立ち会い対応・リモート対応。プロジェクト規模・スケジュール・納品仕様に合わせたワークフロー提案。DaVinci Resolve 認定トレーナーとして講義・講習会も受付。",
]

const profileLines = [
  `- 氏名: ${hpPublicContent.profile.name}`,
  `- 肩書き: ${hpPublicContent.profile.title}`,
  `- 使用ツール: ${hpPublicContent.profile.tools.join(" / ")}`,
  `- SNS: ${hpPublicContent.profile.socialLinks
    .map((link) => `${link.label}: ${link.href}`)
    .join(" / ")}`,
  ...hpPublicContent.profile.timeline.map(
    (item) => `- ${item.year} ${item.event}: ${item.detail}`,
  ),
]

const pressLines = PRESS_CATEGORIES.flatMap((category) => [
  `- ${category.title}`,
  ...category.items.map((item) => {
    const links = item.links.map((link) => `${link.label}: ${link.href}`).join(" / ")
    return `  - ${item.period} ${item.title}: ${item.description} / 掲載リンク: ${links}`
  }),
])

const noteLines = publishedNotesSnapshot.map(
  (note) =>
    `- ${note.title} (${note.sourceUrl}, lastEdited=${note.lastEditedTime})`,
)

const workLines = FEATURED_WORKS.map((work) => {
  const links = work.links.map((link) => `${link.label}: ${link.url}`).join(" / ")
  return `- ${work.title}（${work.client}） / 公式: ${work.officialUrl} / 掲載リンク: ${links}`
})

export const hpPublicKnowledge = [
  "HP公開情報ナレッジ（norikane.studio staging snapshot）。HPに実際に公開されている情報だけを答える。",
  "HPにない案件名、取引先、担当範囲、件数、数値、進行中案件、下書きノート、パスワードゲート内、他顧客情報、予約カレンダー上の他人の予定は出さない。",
  "予約カレンダーは、認証済み userContext に含まれる本人関連の予約文脈だけを扱う。未ログインまたは本人特定不能なら、個別予約情報を出さず一般的な予約導線に留める。",
  "",
  "Hero / 導入 / サービス:",
  ...serviceLines,
  "",
  "プロフィール / 経歴:",
  ...profileLines,
  "",
  "ノート（HP公開済み情報。詳細本文はオンデマンド知識参照で扱う）:",
  ...noteLines,
  "",
  "プレス / 掲載:",
  ...pressLines,
  "",
  "Featured Works / 実績:",
  "実績、作品、Works、ポートフォリオを聞かれたら、このHP掲載範囲では具体名を答えてよい。",
  ...workLines,
  "- ライブ映像作品多数（配信）。",
].join("\n")
