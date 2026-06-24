import type { ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import { isLectureTrainingInquiry } from "@/lib/chatbot/server/lecture-training"

export type ChatbotFlowStep =
  | "conversation"
  | "booking-final-confirmation"
  | "booking-card"
  | "consultation-summary-form"
  | "direct-contact-card"
  | "choice-panel"
  | "tier4-inquiry-form"

export function applyBookingFinalConfirmationAnswer(input: {
  conversationState: ConversationState
  latestUserMessage: string
}): ConversationState {
  const current = input.conversationState.bookingFinalConfirmation
  if (current?.status !== "pending") return input.conversationState

  if (isNoAdditionalBookingConcern(input.latestUserMessage)) {
    return {
      ...input.conversationState,
      bookingFinalConfirmation: {
        ...current,
        status: "confirmed",
        confirmedAtTurn: input.conversationState.turnCount,
      },
    }
  }

  return {
    ...input.conversationState,
    bookingFinalConfirmation: {
      ...current,
      status: "supplemental-received",
      supplementalNote: input.latestUserMessage.trim().slice(0, 500),
    },
  }
}

export function applyBookingFinalConfirmationPolicy(input: {
  routingDecision: RoutingDecision | undefined
  conversationState: ConversationState
  jobContext: JobContext
  latestUserMessage: string
}): {
  routingDecision: RoutingDecision | undefined
  conversationState: ConversationState
} {
  if (isLectureTrainingInquiry(input.conversationState)) {
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  if (
    (input.conversationState.bookingFinalConfirmation?.status === "pending" &&
      !isNoAdditionalBookingConcern(input.latestUserMessage)) ||
    input.conversationState.bookingFinalConfirmation?.status === "supplemental-received"
  ) {
    return {
      routingDecision:
        input.routingDecision?.kind === "to-booking-inline"
          ? {
              kind: "continue",
              nextQuestion: "補足を反映しました。必要な点を確認してから進めます。",
            }
          : input.routingDecision ?? {
              kind: "continue",
              nextQuestion: "補足を反映しました。必要な点を確認してから進めます。",
            },
      conversationState: input.conversationState,
    }
  }

  if (input.routingDecision?.kind !== "to-booking-inline") {
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  if (input.conversationState.bookingFinalConfirmation?.status === "confirmed") {
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  return {
    routingDecision: {
      kind: "continue",
      nextQuestion: buildBookingFinalConfirmationQuestion(input.jobContext),
    },
    conversationState: {
      ...input.conversationState,
      bookingFinalConfirmation: {
        status: "pending",
        requestedAtTurn: input.conversationState.turnCount,
        bookingPrefill: input.routingDecision.bookingPrefill,
      },
    },
  }
}

export function inferChatbotFlowStep(input: {
  routingDecision: RoutingDecision | undefined
  uiKind: string
  conversationState: ConversationState
}): ChatbotFlowStep {
  if (input.conversationState.bookingFinalConfirmation?.status === "pending") {
    return "booking-final-confirmation"
  }
  switch (input.uiKind) {
    case "booking-card":
      return "booking-card"
    case "consultation-summary-form":
      return "consultation-summary-form"
    case "direct-contact-card":
      return "direct-contact-card"
    case "choice-panel":
      return "choice-panel"
    case "tier4-inquiry-form":
      return "tier4-inquiry-form"
    default:
      return input.routingDecision?.kind === "to-booking-inline" ? "booking-card" : "conversation"
  }
}

export function isNoAdditionalBookingConcern(message: string): boolean {
  const compact = message
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　。、,.!！?？「」『』()[\]（）]/g, "")
  return /^(なし|無し|ない|ありません|大丈夫|だいじょうぶ|問題ありません|問題ない|ok|okay|okです|以上です|特にありません)$/.test(
    compact,
  )
}

function buildBookingFinalConfirmationQuestion(jobContext: JobContext): string {
  const summary = [
    jobContext.jobKind ? `案件種別は${jobContext.jobKind}` : undefined,
    jobContext.finalMedium && jobContext.finalMedium !== "other" ? `最終媒体は${jobContext.finalMedium}` : undefined,
    typeof jobContext.projectLengthMinutes === "number" ? `尺は${formatMinutes(jobContext.projectLengthMinutes)}` : undefined,
  ].filter((item): item is string => Boolean(item))
  const prefix = summary.length > 0 ? `${summary.join("、")}として整理しています。` : "ここまでの内容で整理しています。"

  return `${prefix}ほかに確認したいこと、伝えておきたいこと、不安な点はありますか？なければ「なし」で進めます。`
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60
    return Number.isInteger(hours) ? `${hours}時間` : `${hours.toFixed(1).replace(/\.0$/u, "")}時間`
  }
  return `${minutes}分`
}
