import type { RoutingDecision } from "@/lib/chatbot/domain/routing-decision"

export type ChatbotForbiddenTopicId =
  | "pricing"
  | "contract-decision"
  | "personal-life"
  | "other-client"
  | "technical-secret"
  | "private-method"

export type ChatbotForbiddenTopic = {
  id: ChatbotForbiddenTopicId
  routingReason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]
  label: string
  instruction: string
}

export const chatbotForbiddenTopics = [
  {
    id: "pricing",
    routingReason: "pricing",
    label: "料金",
    instruction: "金額・単価・概算・相場は出さず、本人確認へ誘導する。",
  },
  {
    id: "contract-decision",
    routingReason: "contract-decision",
    label: "契約判断",
    instruction: "契約可否・法務判断・条件承認は本人確認へ誘導する。",
  },
  {
    id: "personal-life",
    routingReason: "personal-life",
    label: "私生活",
    instruction: "本人の私生活・住所・家族・健康・私的予定には答えない。",
  },
  {
    id: "other-client",
    routingReason: "other-client",
    label: "他案件情報",
    instruction: "他顧客・他案件・進行中案件の情報は参照も推測もしない。",
  },
  {
    id: "technical-secret",
    routingReason: "confidential-technique",
    label: "技術機密",
    instruction: "内部手順、ノード構成、非公開の検証方法、固有ツール詳細は出さない。",
  },
  {
    id: "private-method",
    routingReason: "confidential-technique",
    label: "非公開手法",
    instruction: "非公開手法の固有名はチャットボット側から出さない。",
  },
] as const satisfies readonly ChatbotForbiddenTopic[]

export const directContactPolicyMessage =
  "のりかねさんに直接確認するので、連絡送りましょうか？メールアドレスもあわせて教えてください。"
