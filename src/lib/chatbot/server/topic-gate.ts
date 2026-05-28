import type { ConversationState } from "@/lib/chatbot/domain"

export type TopicGateResult = Pick<
  ConversationState,
  | "asksPricing"
  | "contractDecision"
  | "personalQuestion"
  | "otherClientInformation"
  | "confidentialTechniqueQuestion"
  | "privateMethodNameExposure"
  | "technicalQuestion"
  | "workReviewRequest"
  | "lookDecomposerDetail"
  | "outOfScope"
>

export function classifyChatbotTopic(message: string): TopicGateResult {
  const normalized = message.normalize("NFKC").toLowerCase()

  return {
    ...(matchesAny(normalized, pricePatterns) ? { asksPricing: true } : {}),
    ...(matchesAny(normalized, contractPatterns) ? { contractDecision: true } : {}),
    ...(matchesAny(normalized, personalPatterns) ? { personalQuestion: true } : {}),
    ...(matchesAny(normalized, otherClientPatterns) ? { otherClientInformation: true } : {}),
    ...(matchesAny(normalized, confidentialTechniquePatterns)
      ? { confidentialTechniqueQuestion: true }
      : {}),
    ...(matchesAny(normalized, privateMethodNamePatterns) ? { privateMethodNameExposure: true } : {}),
    ...(matchesAny(normalized, technicalQuestionPatterns) ? { technicalQuestion: true } : {}),
    ...(matchesAny(normalized, reviewPatterns) ? { workReviewRequest: true } : {}),
    ...(matchesAny(normalized, lookDecomposerPatterns) ? { lookDecomposerDetail: true } : {}),
  }
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

const pricePatterns = [
  /料金/u,
  /金額/u,
  /見積(?:もり)?(?:額|金額)?/u,
  /いくら/u,
  /単価/u,
  /予算/u,
  /費用/u,
  /相場/u,
] as const

const contractPatterns = [
  /契約(?:でき|可否|判断|条件|締結|書)/u,
  /受け(?:られ|てくれ|てもらえ)る/u,
  /確約/u,
  /発注して(?:よい|いい)/u,
] as const

const personalPatterns = [
  /住所/u,
  /家族/u,
  /年収/u,
  /健康/u,
  /私生活/u,
  /休日/u,
  /プライベート/u,
] as const

const otherClientPatterns = [
  /他(?:の)?(?:クライアント|顧客|案件|会社)/u,
  /別案件/u,
  /進行中(?:の)?案件/u,
  /誰(?:と|の案件)/u,
] as const

const confidentialTechniquePatterns = [
  /ノード(?:構成|ツリー|の中身)/u,
  /内部(?:手法|手順|実装|処理)/u,
  /秘密(?:の)?(?:手法|レシピ|設定)/u,
  /技術(?:機密|の中身)/u,
  /プリセット(?:の中身|を教えて)/u,
] as const

const privateMethodNamePatterns = [
  /look\s*decomposer/u,
  /look\s*decomposition/u,
  /lut\s*decomposer/u,
] as const

const technicalQuestionPatterns = [
  /(?:やり方|手順|設定値|数式|コード|実装方法)を教えて/u,
  /(?:resolve|baselight|aces|lut|cdl).*(?:設定|手順|やり方)/u,
] as const

const reviewPatterns = [
  /(?:作品|映像|動画|カット).*(?:レビュー|講評|添削|評価)して/u,
  /見て(?:評価|レビュー|添削)して/u,
] as const

const lookDecomposerPatterns = [/look\s*decomposer\s*v?2?/u] as const
