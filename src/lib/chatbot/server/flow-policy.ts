import type { ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import { bookingFinalConfirmationChoices, projectLengthChoicesForJobKind, surveyChoiceSets } from "@/lib/chatbot/domain"
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
  if (input.conversationState.bookingSubmission?.status === "submitted") {
    return input.conversationState
  }
  const current = input.conversationState.bookingFinalConfirmation
  const fallbackNoAdditionalConcern = isNoAdditionalBookingConcern(input.latestUserMessage)
  if (current?.status === "supplemental-received" && fallbackNoAdditionalConcern) {
    return markBookingFinalConfirmationConfirmed(input.conversationState, "fallback-pattern")
  }
  if (current?.status !== "pending" && !isBookingFinalConfirmationPrompt(input.previousAssistantMessage)) {
    return input.conversationState
  }

  if (fallbackNoAdditionalConcern) {
    return markBookingFinalConfirmationConfirmed(input.conversationState, "fallback-pattern")
  }

  return {
    ...input.conversationState,
    bookingReadiness: {
      ...(input.conversationState.bookingReadiness ?? {}),
      finalQuestionOffered: true,
      finalQuestionOfferedAtTurn:
        input.conversationState.bookingReadiness?.finalQuestionOfferedAtTurn ??
        current?.requestedAtTurn ??
        input.conversationState.turnCount,
      additionalConcernStatus: "unknown",
      additionalConcernUpdatedAtTurn: input.conversationState.turnCount,
    },
    bookingFinalConfirmation: {
      ...current,
      status: "pending",
      requestedAtTurn: current?.requestedAtTurn ?? input.conversationState.turnCount,
    },
  }
}

export function applyBookingFinalConfirmationPolicy(input: {
  routingDecision: RoutingDecision | undefined
  fallbackRoutingDecision: RoutingDecision
  conversationState: ConversationState
  jobContext: JobContext
  latestUserMessage: string
  assistantText: string
}): {
  routingDecision: RoutingDecision | undefined
  conversationState: ConversationState
} {
  if (input.conversationState.bookingSubmission?.status === "submitted") {
    return {
      routingDecision:
        input.routingDecision?.kind === "continue" && /予約番号|送信完了|受け付け済み/u.test(input.routingDecision.nextQuestion)
          ? input.routingDecision
          : undefined,
      conversationState: input.conversationState,
    }
  }

  if (input.conversationState.activeIntakeClarification?.status === "needs-clarification") {
    return applyIntakeClarificationPolicy({
      routingDecision: input.routingDecision,
      conversationState: input.conversationState,
      jobContext: input.jobContext,
    })
  }

  if (isLectureTrainingInquiry(input.conversationState)) {
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  const missingReadinessSlots = getMissingBookingReadinessSlots(input.conversationState, {
    jobContext: input.jobContext,
    bookingPrefill:
      input.routingDecision?.kind === "to-booking-inline" ? input.routingDecision.bookingPrefill : undefined,
  })
  if (input.routingDecision?.kind === "to-booking-inline" && missingReadinessSlots.length > 0) {
    return {
      routingDecision:
        input.fallbackRoutingDecision.kind === "continue"
          ? input.fallbackRoutingDecision
          : {
              kind: "continue",
              nextQuestion: buildMissingBookingReadinessQuestion(missingReadinessSlots[0]),
            },
      conversationState: input.conversationState,
    }
  }

  if (
    input.routingDecision?.kind === "to-booking-inline" &&
    input.conversationState.bookingFinalConfirmation?.status !== "confirmed" &&
    wasBookingFinalQuestionOffered(input.conversationState) &&
    (isCleanBookingProceedSignal(input.assistantText) || isLlmNoAdditionalBookingConcernSignal(input.assistantText))
  ) {
    return {
      routingDecision: input.routingDecision,
      conversationState: markBookingFinalConfirmationConfirmed(input.conversationState, "llm-booking-card", {
        bookingPrefill: input.routingDecision.bookingPrefill,
      }),
    }
  }

  if (
    (input.conversationState.bookingFinalConfirmation?.status === "pending" &&
      !hasNoAdditionalBookingConcern(input.conversationState, input.latestUserMessage)) ||
    input.conversationState.bookingFinalConfirmation?.status === "supplemental-received"
  ) {
    return {
      routingDecision: {
        kind: "continue",
        nextQuestion: "補足を反映しました。必要な点を確認してから進めます。",
      },
      conversationState: markBookingFinalConfirmationSupplemental(input.conversationState, input.latestUserMessage),
    }
  }

  if (input.routingDecision?.kind !== "to-booking-inline") {
    if (
      !input.routingDecision &&
      input.fallbackRoutingDecision.kind === "continue" &&
      input.fallbackRoutingDecision.presentChoices?.id === bookingFinalConfirmationChoices.id &&
      input.conversationState.bookingFinalConfirmation?.status !== "confirmed"
    ) {
      return {
        routingDecision: input.fallbackRoutingDecision,
        conversationState: {
          ...markFinalQuestionOffered(input.conversationState),
          bookingFinalConfirmation: {
            status: "pending",
            requestedAtTurn: input.conversationState.turnCount,
          },
        },
      }
    }
    if (
      (isBookingFinalConfirmationPrompt(input.assistantText) ||
        (input.routingDecision?.kind === "continue" &&
          input.routingDecision.presentChoices?.id === bookingFinalConfirmationChoices.id)) &&
      input.conversationState.bookingFinalConfirmation?.status !== "confirmed"
    ) {
      const nextQuestion = buildBookingFinalConfirmationQuestion(input.jobContext)
      return {
        routingDecision: {
          kind: "continue",
          nextQuestion,
          presentChoices: bookingFinalConfirmationChoices,
        },
        conversationState: {
          ...markFinalQuestionOffered(input.conversationState),
          bookingFinalConfirmation: {
            status: "pending",
            requestedAtTurn: input.conversationState.turnCount,
          },
        },
      }
    }
    return { routingDecision: input.routingDecision, conversationState: input.conversationState }
  }

  if (
    input.conversationState.bookingFinalConfirmation?.status !== "confirmed" &&
    (hasNoAdditionalBookingConcern(input.conversationState, input.latestUserMessage) ||
      wasBookingFinalQuestionOffered(input.conversationState)) &&
    isBookingCardlessAcceptanceText(input.assistantText)
  ) {
    return {
      routingDecision: input.routingDecision,
      conversationState: markBookingFinalConfirmationConfirmed(input.conversationState, "llm-booking-card", {
        bookingPrefill: input.routingDecision.bookingPrefill,
      }),
    }
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
      ...markFinalQuestionOffered(input.conversationState),
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
  jobContext: JobContext
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
      ...clarificationChoiceSet(clarification.choiceSetId, input.jobContext),
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

export function getMissingBookingReadinessSlots(
  conversationState: ConversationState,
  options: {
    jobContext?: JobContext
    bookingPrefill?: Extract<RoutingDecision, { kind: "to-booking-inline" }>["bookingPrefill"]
  } = {},
): BookingReadinessSlot[] {
  const jobContext = options.jobContext
  return [
    conversationState.hasJobKind || jobContext?.jobKind ? undefined : "job-kind",
    conversationState.hasProjectLength ||
      typeof jobContext?.projectLengthMinutes === "number" ||
      hasImplicitProjectLength(jobContext?.jobKind)
      ? undefined
      : "project-length",
    conversationState.hasFinalMedium || (jobContext?.finalMedium && jobContext.finalMedium !== "other")
      ? undefined
      : "final-medium",
    conversationState.hasWorkSite || jobContext?.workSite ? undefined : "work-site",
    conversationState.hasContactEmail && conversationState.contactEmail ? undefined
      : options.bookingPrefill?.contactEmail ? undefined
        : "contact-email",
  ].filter((item): item is BookingReadinessSlot => Boolean(item))
}

type BookingReadinessSlot =
  | "job-kind"
  | "project-length"
  | "final-medium"
  | "work-site"
  | "contact-email"

export function wasBookingFinalQuestionOffered(conversationState: ConversationState): boolean {
  return Boolean(
    conversationState.bookingReadiness?.finalQuestionOffered ||
      conversationState.bookingFinalConfirmation?.status === "pending" ||
      conversationState.bookingFinalConfirmation?.status === "confirmed" ||
      conversationState.bookingFinalConfirmation?.status === "supplemental-received",
  )
}

function clarificationChoiceSet(
  choiceSetId: string | undefined,
  jobContext: JobContext,
): Pick<Extract<RoutingDecision, { kind: "continue" }>, "presentChoices"> | Record<string, never> {
  if (!choiceSetId) return {}
  if (choiceSetId === "project-length") return { presentChoices: projectLengthChoicesForJobKind(jobContext.jobKind) }
  const choiceSet = surveyChoiceSets.find((item) => item.id === choiceSetId)
  return choiceSet ? { presentChoices: choiceSet } : {}
}

export function isNoAdditionalBookingConcern(message: string): boolean {
  const compact = message
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*選択\s*[:：]\s*/u, "")
    .replace(/[\s　。、,.!！?？「」『』()[\]（）]/g, "")
  return (
    /^(なし|無し|ない|ありません|大丈夫|だいじょうぶ|了解|了解です|良い|良いです|いい|いいです|ok|okay|okです|問題ありません|問題ない|以上です|特にありません)(このまま進める|このまますすめる)?$/.test(
      compact,
    ) ||
    /^(特にない|特になし)(?:です)?(このまま進める|このまますすめる)?$/.test(compact)
  )
}

function hasNoAdditionalBookingConcern(conversationState: ConversationState, latestUserMessage: string): boolean {
  return (
    conversationState.bookingReadiness?.additionalConcernStatus === "none" ||
    conversationState.bookingFinalConfirmation?.status === "confirmed" ||
    isNoAdditionalBookingConcern(latestUserMessage)
  )
}

function hasImplicitProjectLength(jobKind: JobContext["jobKind"] | undefined): boolean {
  return Boolean(jobKind && /(?:-\d+[smh]|feature-90m|vertical-60s)/u.test(jobKind))
}

function isCleanBookingProceedSignal(assistantText: string): boolean {
  const displayText = extractCustomerReplyText(assistantText) ?? assistantText
  const withoutTool = displayText.replace(/\{[\s\S]*"tool"\s*:\s*"show_booking_card"[\s\S]*\}/u, "").trim()
  if (!withoutTool) return true
  return (
    /候補|予約|カード|受付|進め/u.test(withoutTool) &&
    !/(補足|確認|教えて|必要|不安|気になる|ありますか|ですか|でしょうか)/u.test(withoutTool)
  )
}

function extractCustomerReplyText(rawText: string): string | undefined {
  return /<customer_reply>\s*([\s\S]*?)\s*<\/customer_reply>/iu.exec(rawText)?.[1]?.trim()
}

export function isLlmNoAdditionalBookingConcernSignal(rawText: string): boolean {
  const normalized = rawText.normalize("NFKC").toLowerCase()
  if (/(案件名|作品タイトル|project\s*title|title).{0,80}(未定|ない|なし|don't have|do not have|not have)/iu.test(normalized)) {
    return false
  }
  return (
    /(?:no|nothing)\s+(?:additional|particular|else|more|concerns?|questions?)/iu.test(normalized) ||
    /(?:追加|ほか|他|確認|懸念|不安|質問).{0,40}(?:ない|なし|ありません|特にない|特になし)/u.test(normalized) ||
    /特に.{0,12}(?:ない|なし|ありません)/u.test(normalized)
  )
}

function markFinalQuestionOffered(conversationState: ConversationState): ConversationState {
  return {
    ...conversationState,
    bookingReadiness: {
      ...(conversationState.bookingReadiness ?? {}),
      finalQuestionOffered: true,
      finalQuestionOfferedAtTurn:
        conversationState.bookingReadiness?.finalQuestionOfferedAtTurn ?? conversationState.turnCount,
    },
  }
}

function markBookingFinalConfirmationConfirmed(
  conversationState: ConversationState,
  source: NonNullable<ConversationState["bookingReadiness"]>["additionalConcernSource"],
  options: { bookingPrefill?: Extract<RoutingDecision, { kind: "to-booking-inline" }>["bookingPrefill"] } = {},
): ConversationState {
  return {
    ...conversationState,
    bookingReadiness: {
      ...(conversationState.bookingReadiness ?? {}),
      finalQuestionOffered: true,
      finalQuestionOfferedAtTurn:
        conversationState.bookingReadiness?.finalQuestionOfferedAtTurn ??
        conversationState.bookingFinalConfirmation?.requestedAtTurn ??
        conversationState.turnCount,
      additionalConcernStatus: "none",
      additionalConcernSource: source,
      additionalConcernUpdatedAtTurn: conversationState.turnCount,
    },
    bookingFinalConfirmation: {
      ...(conversationState.bookingFinalConfirmation ?? {}),
      status: "confirmed",
      confirmedAtTurn: conversationState.turnCount,
      ...(options.bookingPrefill ? { bookingPrefill: options.bookingPrefill } : {}),
    },
  }
}

function markBookingFinalConfirmationSupplemental(
  conversationState: ConversationState,
  latestUserMessage: string,
): ConversationState {
  return {
    ...conversationState,
    bookingReadiness: {
      ...(conversationState.bookingReadiness ?? {}),
      finalQuestionOffered: true,
      finalQuestionOfferedAtTurn:
        conversationState.bookingReadiness?.finalQuestionOfferedAtTurn ??
        conversationState.bookingFinalConfirmation?.requestedAtTurn ??
        conversationState.turnCount,
      additionalConcernStatus: "has-concern",
      additionalConcernUpdatedAtTurn: conversationState.turnCount,
    },
    bookingFinalConfirmation: {
      ...(conversationState.bookingFinalConfirmation ?? {}),
      status: "supplemental-received",
      supplementalNote: latestUserMessage.trim().slice(0, 500),
    },
  }
}

function buildMissingBookingReadinessQuestion(slot: ReturnType<typeof getMissingBookingReadinessSlots>[number]): string {
  switch (slot) {
    case "job-kind":
      return "まず案件種別を選んでください"
    case "project-length":
      return "尺・分量を1つ教えてください。"
    case "final-medium":
      return "最終媒体は何になりますか？"
    case "work-site":
      return "作業場所のご希望はありますか？"
    case "contact-email":
      return "ご連絡先メールを教えてください"
  }
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

function isBookingCardlessAcceptanceText(message: string | undefined): boolean {
  if (!message) return false
  const normalized = message.normalize("NFKC").toLowerCase()
  return /受付完了|このまま受付|受付として進め|ご連絡いたします|メールアドレス.{0,40}連絡/u.test(normalized)
}

export function buildBookingFinalConfirmationQuestion(jobContext: JobContext): string {
  const summary = [
    labelRequestCategory(jobContext),
    labelDeliveryUse(jobContext),
    typeof jobContext.projectLengthMinutes === "number" ? `尺は${formatMinutes(jobContext.projectLengthMinutes)}` : undefined,
  ].filter((item): item is string => Boolean(item))
  const prefix = summary.length > 0 ? `${summary.join("、")}として整理しています。` : "ここまでの内容で整理しています。"

  return `${prefix}ほかに確認したいこと、伝えておきたいこと、不安な点はありますか？なければ「なし」で進めます。`
}

function labelRequestCategory(jobContext: JobContext): string | undefined {
  switch (jobContext.jobKind) {
    case "live-60m":
      return "依頼内容はライブ"
    case "cm-30s":
      return "依頼内容はWeb CM / CM"
    case "mv-5m":
      return "依頼内容はMV"
    case "feature-90m":
      return "依頼内容は映画 / 長編"
    case "drama-first":
    case "drama-follow-up":
      return "依頼内容はドラマ"
    case "vertical-60s":
      return "依頼内容は縦型動画 / SNS動画"
    default:
      return undefined
  }
}

function labelDeliveryUse(jobContext: JobContext): string | undefined {
  switch (jobContext.finalMedium) {
    case "ott":
      return "納品・使用先は配信"
    case "cinema":
      return "納品・使用先は映画 / 劇場"
    case "tv-broadcast":
      return "納品・使用先は放送"
    case "live":
      return "納品・使用先はライブ / イベント"
    case "web":
      return "納品・使用先はWeb / CM"
    case "vertical-sns":
      return "納品・使用先は縦型SNS"
    default:
      return undefined
  }
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60
    return Number.isInteger(hours) ? `${hours}時間` : `${hours.toFixed(1).replace(/\.0$/u, "")}時間`
  }
  return `${minutes}分`
}
