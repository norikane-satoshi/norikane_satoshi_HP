import {
  hasRequiredEmailConsultationSlots,
  type ConversationState,
  type JobContext,
  type RoutingDecision,
} from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  documentaryAttachmentChoices,
  finalMediumChoices,
  productionOptionChoices,
  remoteWorkSiteConfirmationChoices,
  specificWorkSiteChoices,
  workSiteChoices,
} from "@/lib/chatbot/domain"
import { directContactPolicyMessage } from "@/lib/chatbot/knowledge/forbidden-topics"
import {
  complexConversationTurnThreshold,
  candidateWindowGranularityByJobKind,
  settledConversationTurnThreshold,
  tightDeadlineThresholdDays,
  tightishDeadlineMaxDays,
} from "@/lib/chatbot/knowledge/workflow-duration"
import { initialIntakeQuestions } from "@/lib/chatbot/knowledge/response-policy"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"

export type RoutingDecisionInput = {
  jobContext: JobContext
  conversationState: ConversationState
  latestUserMessage?: string
}

export function decideRoutingFallback(input: RoutingDecisionInput): RoutingDecision {
  const { jobContext, conversationState } = input
  const estimate = jobContext.jobKind ? estimateWorkflow(jobContext) : undefined

  if (estimate?.requiresDirectContact) return directContact("heavy-retouch")

  if (
    conversationState.daysUntilStart !== undefined &&
    conversationState.daysUntilStart <= tightDeadlineThresholdDays
  ) {
    return directContact("tight-deadline")
  }

  if (conversationState.vfxCgHeavy) return directContact("vfx-cg-heavy")
  if (conversationState.editingIncomplete) return directContact("raw-edit-included")
  if (conversationState.asksPricing) return directContact("pricing")
  if (conversationState.contractDecision) return directContact("contract-decision")
  if (conversationState.personalQuestion) return directContact("personal-life")
  if (conversationState.otherClientInformation) return directContact("other-client")
  if (conversationState.confidentialTechniqueQuestion || conversationState.privateMethodNameExposure) {
    return directContact("confidential-technique")
  }
  if (conversationState.technicalQuestion) return directContact("tech-question")
  if (conversationState.workReviewRequest) return directContact("review-request")
  if (conversationState.outOfScope) return directContact("out-of-scope")
  if (conversationState.turnCount >= complexConversationTurnThreshold) return directContact("complex")

  if (
    conversationState.daysUntilStart !== undefined &&
    conversationState.daysUntilStart <= tightishDeadlineMaxDays &&
    !conversationState.hasContactEmail
  ) {
    return {
      kind: "continue",
      nextQuestion: "素材搬入時期と納品希望日を確認するため 1 点伸ばさせて下さい",
    }
  }

  if (shouldPrioritizeSchedule(jobContext, conversationState)) {
    return {
      kind: "to-booking-inline",
      suggestedSlots: buildCandidateWindows(jobContext),
      jobContext: {
        ...jobContext,
        workflowEstimate: jobContext.workflowEstimate ?? buildWorkflowEstimate(jobContext),
      },
    }
  }

  if (
    conversationState.hasDesiredSchedule &&
    conversationState.hasFinalMedium &&
    conversationState.hasJobKind &&
    conversationState.hasProjectLength &&
    Boolean(conversationState.hasMaterialHandoff) &&
    !conversationState.hasPendingAdditionalWorkOther &&
    !conversationState.hasPendingRemoteWorkSiteRecommendation &&
    !conversationState.declinedRemoteWorkSiteRecommendation &&
    Boolean(conversationState.hasProjectTitle) &&
    conversationState.hasContactEmail
  ) {
    return {
      kind: "to-booking-inline",
      suggestedSlots: [],
      jobContext: {
        ...jobContext,
        workflowEstimate:
          jobContext.workflowEstimate ?? (jobContext.jobKind ? estimateWorkflow(jobContext) : undefined),
      },
    }
  }

  if (
    hasRequiredEmailConsultationSlots({ conversationState }) &&
    !conversationState.hasDesiredSchedule &&
    conversationState.turnCount >= settledConversationTurnThreshold
  ) {
    return {
      kind: "to-email",
      summary: {
        subject: "チャットボット相談",
        customerEmail: conversationState.contactEmail ?? "",
        ...(conversationState.customerName ? { customerName: conversationState.customerName } : {}),
        ...(conversationState.companyName ? { companyName: conversationState.companyName } : {}),
        jobContext,
        summaryText: buildSummaryText(jobContext, conversationState),
        openQuestions: buildOpenQuestions(conversationState),
      },
    }
  }

  return continueDecision(conversationState, input.latestUserMessage)
}

function directContact(reason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]) {
  return {
    kind: "to-direct-contact",
    reason,
    requireEmail: true,
    suggestedMessage: directContactPolicyMessage,
  } as const
}

function continueDecision(
  conversationState: ConversationState,
  latestUserMessage?: string,
): RoutingDecision {
  if (
    conversationState.turnCount <= 1 &&
    (!conversationState.hasJobKind ||
      !conversationState.hasDesiredSchedule ||
      !conversationState.hasCustomerIdentity)
  ) {
    return {
      kind: "continue",
      nextQuestion: `まず ${initialIntakeQuestions.join(" / ")} を教えてください。`,
    }
  }

  if (!conversationState.hasCustomerIdentity) {
    return {
      kind: "continue",
      nextQuestion: "お名前と会社名を教えてください。",
    }
  }

  if (!conversationState.hasFinalMedium) {
    return {
      kind: "continue",
      nextQuestion: "最終媒体は何になりますか？",
      presentChoices: finalMediumChoices,
    }
  }

  if (!conversationState.hasJobKind || !conversationState.hasProjectLength) {
    return {
      kind: "continue",
      nextQuestion: "案件種別と尺を教えてください",
    }
  }

  if (!conversationState.hasMaterialHandoff) {
    return {
      kind: "continue",
      nextQuestion: "撮影素材をどう受け渡す予定か教えてください",
    }
  }

  if (!conversationState.hasAdditionalWork) {
    if (conversationState.hasPendingAdditionalWorkOther) {
      return {
        kind: "continue",
        nextQuestion: buildAdditionalWorkOtherQuestion(latestUserMessage),
      }
    }

    return {
      kind: "continue",
      nextQuestion: "カラグレ以外の追加作業はありますか？",
      presentChoices: additionalWorkChoices,
    }
  }

  if (!conversationState.hasDocumentaryAttachments) {
    return {
      kind: "continue",
      nextQuestion: "付随する映像はありますか？",
      presentChoices: documentaryAttachmentChoices,
    }
  }

  if (!conversationState.hasWorkSite) {
    if (conversationState.hasPendingRemoteWorkSiteRecommendation) {
      return {
        kind: "continue",
        nextQuestion: remoteWorkSiteConfirmationChoices.question,
        presentChoices: remoteWorkSiteConfirmationChoices,
      }
    }

    if (conversationState.declinedRemoteWorkSiteRecommendation) {
      return {
        kind: "continue",
        nextQuestion: "具体的な作業場所のご希望を教えてください。",
        presentChoices: specificWorkSiteChoices,
      }
    }

    return {
      kind: "continue",
      nextQuestion: "作業場所のご希望はありますか？",
      presentChoices: workSiteChoices,
    }
  }

  if (!conversationState.hasProjectTitle) {
    return {
      kind: "continue",
      nextQuestion: "案件名（プロジェクト名・作品名）を教えてください。まだ未定なら仮の呼び名でも大丈夫です。",
    }
  }

  if (!conversationState.hasReferenceUrls) {
    return {
      kind: "continue",
      nextQuestion: "事前に把握しておきたい参考URLがあれば教えてください",
    }
  }

  if (!conversationState.hasMaterialDetails) {
    return {
      kind: "continue",
      nextQuestion: "差し支えなければ、素材内容（カメラ台数・収録形式・解像度・フレームレートなど）も教えてください",
    }
  }

  if (!conversationState.hasDeliveryFormat) {
    return {
      kind: "continue",
      nextQuestion: "納品形式と解像度の希望があれば教えてください",
    }
  }

  if (!conversationState.hasProductionOptions) {
    return {
      kind: "continue",
      nextQuestion: "字幕・テロップ、ナレーション、音楽の有無を教えてください",
      presentChoices: productionOptionChoices,
    }
  }

  if (!conversationState.hasBudgetRange) {
    return {
      kind: "continue",
      nextQuestion: "差し支えなければで構いませんので、ご予算の目安（レンジ）があれば教えてください",
    }
  }

  if (!conversationState.hasDesiredSchedule) {
    return {
      kind: "continue",
      nextQuestion: "素材の搬入（受け取り）時期と納品希望日を教えてください",
    }
  }

  return {
    kind: "continue",
    nextQuestion: "ご連絡先のメールアドレス（必須）を教えてください",
  }
}

function buildAdditionalWorkOtherQuestion(latestUserMessage: string | undefined): string {
  if (!latestUserMessage || !isVagueAdditionalWorkOtherAnswer(latestUserMessage)) {
    return "「その他」とは具体的にどのような作業ですか？"
  }

  return "「その他」とは具体的にどのような作業ですか？例えば、テロップ整理、簡単な合成、不要物消し以外のレタッチ、納品形式違いの書き出しなど、近いものだけでも大丈夫です。"
}

function isVagueAdditionalWorkOtherAnswer(message: string): boolean {
  const normalized = message.normalize("NFKC").trim().toLowerCase()
  return /^(?:選択\s*[:：]\s*)?(?:わかりません|分かりません|不明|未定|謎|詳しくはまた|まだわからない|まだ分からない|要相談|相談したい|その他)$/u.test(normalized)
}

function buildSummaryText(jobContext: JobContext, conversationState: ConversationState): string {
  const jobKind = jobContext.jobKind ?? "案件種別未確認"
  const schedule = conversationState.hasDesiredSchedule ? "搬入〜納品あり" : "搬入〜納品未定"

  return `${jobKind} / ${jobContext.finalMedium} / ${jobContext.workSite} / ${schedule}`
}

function buildOpenQuestions(conversationState: ConversationState): string[] {
  return [
    conversationState.hasFinalMedium ? undefined : "最終媒体未確認",
    conversationState.hasJobKind && conversationState.hasProjectLength ? undefined : "案件種別・尺未確認",
    conversationState.hasAdditionalWork ? undefined : "追加作業未確認",
    conversationState.hasDocumentaryAttachments ? undefined : "付随映像未確認",
    conversationState.hasWorkSite ? undefined : "作業場所未確認",
    conversationState.hasReferenceUrls ? undefined : "参考URL未確認",
    conversationState.hasDesiredSchedule ? undefined : "素材搬入〜納品時期未確認",
  ].filter((item): item is string => Boolean(item))
}

function shouldPrioritizeSchedule(
  jobContext: JobContext,
  conversationState: ConversationState,
): boolean {
  return (
    conversationState.hasDesiredSchedule &&
    conversationState.hasJobKind &&
    conversationState.hasProjectLength &&
    Boolean(conversationState.hasMaterialHandoff) &&
    conversationState.hasWorkSite &&
    Boolean(conversationState.hasCustomerIdentity) &&
    Boolean(conversationState.hasProjectTitle) &&
    !conversationState.hasPendingAdditionalWorkOther &&
    (conversationState.hasFinalMedium || jobContext.finalMedium === "web") &&
    (isOneHourCandidateJob(jobContext) || isDateCandidateJob(jobContext))
  )
}

function isOneHourCandidateJob(jobContext: JobContext): boolean {
  if (jobContext.jobKind && candidateWindowGranularityByJobKind[jobContext.jobKind] !== "1時間単位") {
    return false
  }

  return (
    jobContext.finalMedium === "web" ||
    jobContext.finalMedium === "vertical-sns" ||
    jobContext.jobKind === "cm-30s" ||
    jobContext.jobKind === "mv-5m"
  )
}

function isDateCandidateJob(jobContext: JobContext): boolean {
  return Boolean(
    jobContext.jobKind && candidateWindowGranularityByJobKind[jobContext.jobKind] === "日付単位",
  )
}

function buildCandidateWindows(jobContext: JobContext) {
  return isDateCandidateJob(jobContext)
    ? buildDateCandidateWindows(jobContext)
    : buildOneHourCandidateWindows(jobContext)
}

function buildOneHourCandidateWindows(jobContext: JobContext) {
  const startDate = jobContext.preferredStartDate ?? "2026-06-15"
  const base = new Date(`${startDate}T10:00:00+09:00`)
  const offsets = [0, 1, 2]

  return offsets.map((offset) => {
    const start = new Date(base.getTime() + offset * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: formatJstOneHourCandidateLabel(start),
      available: true,
      note: "1時間候補",
    }
  })
}

function buildDateCandidateWindows(jobContext: JobContext) {
  const startDate = jobContext.preferredStartDate ?? "2026-06-15"
  const base = new Date(`${startDate}T10:00:00+09:00`)
  const offsets = [0, 1, 2]
  const estimate = jobContext.workflowEstimate ?? buildWorkflowEstimate(jobContext)
  const neededDays = Math.max(1, Math.ceil(estimate.totalMinDays))

  return offsets.map((offset) => {
    const start = new Date(base.getTime() + offset * 24 * 60 * 60 * 1000)
    const end = endOfDateWindow(start, neededDays)
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: `${formatJstDateCandidateLabel(start)} - ${formatJstDateCandidateLabel(end)}`,
      available: true,
      note: `日付候補 / 仮キープ ${neededDays}日`,
    }
  })
}

function endOfDateWindow(start: Date, neededDays: number): Date {
  let cursor = start
  let counted = 0

  while (counted < neededDays) {
    counted += 1
    if (counted < neededDays) cursor = addJstDays(cursor, 1)
  }

  return new Date(cursor.getTime() + 8 * 60 * 60 * 1000)
}

function addJstDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function buildWorkflowEstimate(jobContext: JobContext) {
  if (jobContext.jobKind) return estimateWorkflow(jobContext)

  return {
    stages: [{ stage: "attended" as const, minDays: 0.125, maxDays: 0.125, note: "1時間候補" }],
    totalMinDays: 0.125,
    totalMaxDays: 0.125,
    riskFlags: [],
  }
}

function formatJstOneHourCandidateLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""

  return `${value("month")}月${value("day")}日 ${value("hour")}:00`
}

function formatJstDateCandidateLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""

  return `${value("month")}月${value("day")}日`
}
