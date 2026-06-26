import type { ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import { bookingFinalConfirmationChoices, surveyChoiceSets } from "@/lib/chatbot/domain"
import { isLectureTrainingInquiry } from "@/lib/chatbot/server/lecture-training"

export type ChatbotFlowStep =
  | "conversation"
  | "booking-final-confirmation"
  | "booking-card"
  | "consultation-summary-form"
  | "direct-contact-card"
  | "choice-panel"
  | "choice-clarification"
  | "tier4-inquiry-form"

export function applyBookingFinalConfirmationAnswer(input: {
  conversationState: ConversationState
  latestUserMessage: string
  previousAssistantMessage?: string
}): ConversationState {
  const current = input.conversationState.bookingFinalConfirmation
  if (current?.status !== "pending" && !isBookingFinalConfirmationPrompt(input.previousAssistantMessage)) {
    return input.conversationState
  }

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
  assistantText: string
}): {
  routingDecision: RoutingDecision | undefined
  conversationState: ConversationState
} {
  if (input.conversationState.activeIntakeClarification?.status === "needs-clarification") {
    return applyIntakeClarificationPolicy({
      routingDecision: input.routingDecision,
      conversationState: input.conversationState,
    })
  }

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
    if (
      isBookingFinalConfirmationPrompt(input.assistantText) &&
      input.conversationState.bookingFinalConfirmation?.status !== "confirmed"
    ) {
      return {
        routingDecision: input.routingDecision ?? {
          kind: "continue",
          nextQuestion: input.assistantText.trim(),
          presentChoices: bookingFinalConfirmationChoices,
        },
        conversationState: {
          ...input.conversationState,
          bookingFinalConfirmation: {
            status: "pending",
            requestedAtTurn: input.conversationState.turnCount,
          },
        },
      }
    }
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  if (input.conversationState.bookingFinalConfirmation?.status === "confirmed") {
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  return {
    routingDecision: {
      kind: "continue",
      nextQuestion: buildBookingFinalConfirmationQuestion(input.jobContext),
      presentChoices: bookingFinalConfirmationChoices,
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

export function applyIntakeClarificationPolicy(input: {
  routingDecision: RoutingDecision | undefined
  conversationState: ConversationState
}): {
  routingDecision: RoutingDecision | undefined
  conversationState: ConversationState
} {
  const clarification = input.conversationState.activeIntakeClarification
  if (clarification?.status !== "needs-clarification") {
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  return {
    routingDecision: {
      kind: "continue",
      nextQuestion: clarification.question,
      ...clarificationChoiceSet(clarification.choiceSetId),
    },
    conversationState: input.conversationState,
  }
}

export function inferChatbotFlowStep(input: {
  routingDecision: RoutingDecision | undefined
  uiKind: string
  conversationState: ConversationState
}): ChatbotFlowStep {
  if (input.conversationState.activeIntakeClarification?.status === "needs-clarification") {
    return "choice-clarification"
  }
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

function clarificationChoiceSet(
  choiceSetId: string | undefined,
): Pick<Extract<RoutingDecision, { kind: "continue" }>, "presentChoices"> | Record<string, never> {
  if (!choiceSetId) return {}
  const choiceSet = surveyChoiceSets.find((item) => item.id === choiceSetId)
  return choiceSet ? { presentChoices: choiceSet } : {}
}

export function isNoAdditionalBookingConcern(message: string): boolean {
  const compact = message
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*選択\s*[:：]\s*/u, "")
    .replace(/[\s　。、,.!！?？「」『』()[\]（）]/g, "")
  return /^(なし|無し|ない|ありません|大丈夫|だいじょうぶ|問題ありません|問題ない|ok|okay|okです|以上です|特にありません)(このまま進める|このまますすめる)?$/.test(
    compact,
  )
}

export function isBookingFinalConfirmationPrompt(message: string | undefined): boolean {
  if (!message) return false
  const normalized = message.normalize("NFKC").toLowerCase()
  return (
    /(ほか|他|最後|最終)[\s\S]{0,40}(確認したい|伝えておきたい|不安|気になる|ありますか)/u.test(normalized) &&
    /なし/u.test(normalized) &&
    /(予約|候補|カード|進め)/u.test(normalized)
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
