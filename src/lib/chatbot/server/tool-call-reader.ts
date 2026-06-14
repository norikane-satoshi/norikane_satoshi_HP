import type { ChatbotMessageRole, ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import {
  formatChatbotToolRegistryForPrompt,
  type ChatbotToolName,
} from "@/lib/chatbot/server/tool-dispatcher"

const phaseTwoToolNames: ReadonlyArray<ChatbotToolName> = [
  "create_booking",
  "show_booking_card",
  "get_estimate",
]

export function createChatbotToolCallReadRequest(input: {
  messages: ReadonlyArray<{ role: ChatbotMessageRole; content: string }>
  notionAiThread?: { threadId: string }
  conversationState: ConversationState
  jobContext: JobContext
  routingDecision?: RoutingDecision
  latestUserMessage?: string
}): ChatbotLlmRequest {
  return {
    systemPrompt: [
      "これは外部ツール実行ではなく、アプリ内部dispatcher用の分類JSONを作るタスクです。",
      "あなた自身は予約作成・Notion更新・外部操作を実行しません。",
      "会話全体を読み取り、アプリ内部dispatcherへ渡せる状態ならJSONを1つ返してください。",
      "返す形式は {\"tool\":\"create_booking\",\"args\":{...}} または {\"tool\":\"show_booking_card\",\"args\":{...}} または {\"tool\":\"get_estimate\",\"args\":{...}} のJSONオブジェクト単体だけです。",
      "ツール不要または必須項目不足なら {\"tool\":\"none\",\"args\":{}} を返してください。",
      "追加作業の『その他』内容が未確定なら booking-card / create_booking は返さず、{\"tool\":\"none\",\"args\":{}} を返してください。",
      "booking-card を返す場合、会話中に明示済みの projectTitle, companyName, contactName, contactEmail, dueDate は bookingPrefill に入れてください。",
      "安全判定コンテキストに bookingCardArgs がある場合、会話として候補提示が自然なら show_booking_card を返し、args は bookingCardArgs をそのまま使ってください。",
      "工程目安だけが必要な会話なら get_estimate を返し、args は estimateArgs をそのまま使ってください。",
      "説明文、Markdown、コードフェンス、複数JSONは禁止です。",
      "安全判定コンテキスト:",
      JSON.stringify(buildToolReadContext(input)),
      "利用可能ツール:",
      formatChatbotToolRegistryForPrompt(undefined, { enabledToolNames: phaseTwoToolNames }),
    ].join("\n"),
    messages: input.messages,
    ...(input.notionAiThread ? { notionAiThread: input.notionAiThread } : {}),
    forceFullPrompt: true,
    conversationState: input.conversationState,
    jobContext: input.jobContext,
    latestUserMessage: input.latestUserMessage,
    temperature: 0,
    maxOutputTokens: 260,
  }
}

function buildToolReadContext(input: {
  routingDecision?: RoutingDecision
  jobContext: JobContext
  conversationState: ConversationState
}) {
  return {
    ...(input.routingDecision?.kind === "to-booking-inline" && input.routingDecision.suggestedSlots.length > 0
      ? {
          activeUiRule: "booking-card",
          bookingCardArgs: {
            suggestedSlots: input.routingDecision.suggestedSlots,
            ...(input.routingDecision.busyDateKeys ? { busyDateKeys: input.routingDecision.busyDateKeys } : {}),
            jobContext: input.routingDecision.jobContext,
            bookingPrefill: {
              ...(input.conversationState.projectTitle ? { projectTitle: input.conversationState.projectTitle } : {}),
              ...(input.conversationState.companyName ? { companyName: input.conversationState.companyName } : {}),
              ...(input.conversationState.customerName ? { contactName: input.conversationState.customerName } : {}),
              ...(input.conversationState.contactEmail ? { contactEmail: input.conversationState.contactEmail } : {}),
              ...(input.jobContext.publicReleaseDate ? { dueDate: input.jobContext.publicReleaseDate } : {}),
            },
          },
        }
      : { activeUiRule: input.routingDecision?.kind ?? "none" }),
    ...(input.conversationState.hasPendingAdditionalWorkOther ? { pendingAdditionalWorkOther: true } : {}),
    ...(input.jobContext.jobKind ? { estimateArgs: { jobContext: input.jobContext } } : {}),
  }
}
