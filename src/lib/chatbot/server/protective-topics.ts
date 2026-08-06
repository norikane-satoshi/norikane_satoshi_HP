import type { RoutingDecision } from "@/lib/chatbot/domain"

type ProtectiveReason = Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]

/**
 * Turns the customer's own message into a protective routing reason.
 *
 * `routing.ts` already refuses to answer these topics, but every flag it reads
 * (`asksPricing`, `technicalQuestion`, `contractDecision`, …) was only ever read, never written,
 * and the widget never sends them. The branches were unreachable, so the only thing keeping
 * prices, contract calls and private technique out of an answer was the system prompt — which the
 * harness rules say must never be the guarantee.
 *
 * Detection is deliberately narrow. Each entry matches a customer *asking for* the protected
 * thing, not any mention of it, so describing a budget or naming DaVinci while explaining the job
 * stays in the normal flow. Ordering follows `routing.ts`: the first match wins.
 */
const protectiveTopicPatterns: ReadonlyArray<{ reason: ProtectiveReason; patterns: ReadonlyArray<RegExp> }> = [
  {
    reason: "pricing",
    patterns: [
      /(?:料金|費用|価格|単価|金額|相場|ギャラ)(?:表|感|体系)?[^。！？\n]{0,12}(?:は|が|って|を|の)?[^。！？\n]{0,12}(?:いくら|おいくら|どのくらい|どれくらい|教え|知り|伺|聞き|確認|提示|見せ|ください|下さい|でしょうか|ますか|ですか)/u,
      /(?:いくら|おいくら)[^。！？\n]{0,10}(?:かかり|でしょう|ですか|になります|ますか)/u,
      /(?:お?見積(?:り|もり|書)?)[^。！？\n]{0,12}(?:を|が|は)?[^。！？\n]{0,12}(?:お願い|ほしい|欲しい|ください|下さい|頂け|いただけ|可能|できます)/u,
      /\b(?:how much|what(?:'s| is) the (?:price|cost|rate)|price list|rate card|your rates?)\b/iu,
      /\b(?:cost|charge|quote)\b[^.!?\n]{0,24}\?/iu,
    ],
  },
  {
    reason: "contract-decision",
    patterns: [
      /(?:契約(?:書|条件|内容)?|発注書|注文書|請書|基本契約|業務委託契約|秘密保持契約|NDA|検収条件|支払(?:条件|サイト))[^。！？\n]{0,16}(?:を|は|の|について)?[^。！？\n]{0,16}(?:締結|巻き|交わ|結べ|結ん|対応|可能|お願い|ください|下さい|頂け|いただけ|教え|確認|でしょうか|ますか)/u,
      /\b(?:sign|signing) (?:an? )?(?:nda|contract|agreement)\b/iu,
    ],
  },
  {
    reason: "other-client",
    patterns: [
      /(?:他|ほか|別)(?:社|者)?の?(?:お客(?:様|さん)|クライアント|案件|会社|取引先|依頼主)[^。！？\n]{0,16}(?:は|を|の|って)?[^。！？\n]{0,16}(?:誰|どこ|どんな|何|教え|聞き|知り|一覧|実績|事例|でしょうか|ますか|ですか)/u,
      /(?:どこ|誰)(?:の|が)[^。！？\n]{0,12}(?:作品|案件|映像|仕事)[^。！？\n]{0,12}(?:担当|やっ|手が|関わ)/u,
    ],
  },
  {
    reason: "confidential-technique",
    patterns: [
      /(?:LUT|ノード構成|ノードツリー|パワーグレード|PowerGrade|プリセット|設定ファイル|レシピ)[^。！？\n]{0,16}(?:を|は|の)?[^。！？\n]{0,16}(?:ください|下さい|もらえ|頂け|いただけ|共有|配布|送っ|譲っ|公開|教え)/u,
      /(?:企業秘密|門外不出|非公開(?:の)?(?:技術|手法|ノウハウ)|ノウハウ)[^。！？\n]{0,16}(?:を|は)?[^。！？\n]{0,16}(?:教え|公開|共有|知り|聞き)/u,
    ],
  },
  {
    reason: "plugin-detail",
    patterns: [/LOOK\s*Decomposer/iu],
  },
  {
    reason: "tech-question",
    patterns: [
      /(?:DaVinci|Resolve|ダヴィンチ|リゾルブ|Premiere|After\s*Effects|Baselight)[^。！？\n]{0,20}(?:使い方|操作(?:方法)?|やり方|設定方法|手順|直し方|治し方|解決)/u,
      /(?:自分で|独学で|勉強|上達|覚え)[^。！？\n]{0,30}(?:方法|コツ|やり方|教え)/u,
      /(?:カラコレ|グレーディング|カラーグレーディング)[^。！？\n]{0,12}(?:のやり方|の方法|のコツ|を教わ|を学び|を習い)/u,
    ],
  },
  {
    reason: "review-request",
    patterns: [
      /(?:この|作った|自分の|うちの)[^。！？\n]{0,12}(?:動画|映像|作品|素材|カット)[^。！？\n]{0,16}(?:見て|観て|チェック|添削|評価|レビュー|感想|批評|診断)/u,
      /(?:添削|批評|フィードバック|レビュー)[^。！？\n]{0,12}(?:して|お願い|頂け|いただけ|もらえ)/u,
    ],
  },
  {
    reason: "personal-life",
    patterns: [
      /(?:ご?家族|奥さん|嫁|旦那|お子さん|子供|恋人|彼女|彼氏|結婚|独身|年齢|おいくつ|出身|自宅|お住まい|住所|年収|貯金|趣味は)[^。！？\n]{0,16}(?:は|を|って|の)?[^。！？\n]{0,16}(?:教え|聞き|知り|どこ|なに|何|いくつ|でしょうか|ますか|ですか)/u,
    ],
  },
  {
    reason: "vfx-cg-heavy",
    patterns: [
      /(?:VFX|CG|3DCG|コンポジット|合成)[^。！？\n]{0,16}(?:が|を|は)?[^。！？\n]{0,16}(?:メイン|主体|中心|大半|多く|たくさん|お願い|やって|対応)/u,
    ],
  },
  {
    reason: "raw-edit-included",
    patterns: [
      /(?:編集|オフライン|カット(?:編集)?)[^。！？\n]{0,12}(?:が|は|も)?[^。！？\n]{0,12}(?:まだ|未(?:完了|了)|終わって(?:い)?ない|途中|これから)/u,
      /(?:編集|カット編集|オフライン)[^。！？\n]{0,12}(?:から|も)[^。！？\n]{0,12}(?:お願い|やって|込み|含め|対応)/u,
    ],
  },
]

export function detectProtectiveTopic(latestUserMessage: string | undefined): ProtectiveReason | undefined {
  if (!latestUserMessage) return undefined
  for (const entry of protectiveTopicPatterns) {
    if (entry.patterns.some((pattern) => pattern.test(latestUserMessage))) return entry.reason
  }
  return undefined
}
