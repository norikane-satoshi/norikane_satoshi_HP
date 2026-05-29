import type { ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  documentaryAttachmentChoices,
  finalMediumChoices,
  workSiteChoices,
} from "@/lib/chatbot/domain"
import { directContactPolicyMessage } from "@/lib/chatbot/knowledge/forbidden-topics"
import {
  complexConversationTurnThreshold,
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

  if (
    conversationState.daysUntilStart !== undefined &&
    conversationState.daysUntilStart <= tightishDeadlineMaxDays
  ) {
    return {
      kind: "continue",
      nextQuestion: "契約書条件を確認するため 1 点伸ばさせて下さい",
    }
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

  if (shouldPrioritizeSchedule(jobContext, conversationState)) {
    return {
      kind: "to-booking-inline",
      suggestedSlots: buildOneHourCandidateWindows(jobContext),
      jobContext: {
        ...jobContext,
        workflowEstimate: jobContext.workflowEstimate ?? {
          stages: [{ stage: "attended", minDays: 0.125, maxDays: 0.125, note: "1時間候補" }],
          totalMinDays: 0.125,
          totalMaxDays: 0.125,
          riskFlags: [],
        },
      },
    }
  }

  if (
    conversationState.hasDesiredSchedule &&
    conversationState.hasFinalMedium &&
    conversationState.hasJobKind &&
    conversationState.hasContactEmail
  ) {
    return {
      kind: "to-booking-inline",
      suggestedSlots: [],
      jobContext,
    }
  }

  if (
    conversationState.hasContactEmail &&
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

  return continueDecision(conversationState)
}

function directContact(reason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]) {
  return {
    kind: "to-direct-contact",
    reason,
    requireEmail: true,
    suggestedMessage: directContactPolicyMessage,
  } as const
}

function continueDecision(conversationState: ConversationState): RoutingDecision {
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

  if (!conversationState.hasJobKind) {
    return {
      kind: "continue",
      nextQuestion: "案件種別と尺を教えてください",
    }
  }

  if (!conversationState.hasAdditionalWork) {
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
    return {
      kind: "continue",
      nextQuestion: "作業場所のご希望はありますか？",
      presentChoices: workSiteChoices,
    }
  }

  if (!conversationState.hasReferenceUrls) {
    return {
      kind: "continue",
      nextQuestion: "事前に把握しておきたい参考URLがあれば教えてください",
    }
  }

  if (!conversationState.hasDesiredSchedule) {
    return {
      kind: "continue",
      nextQuestion: "作業や立ち会いはいつごろできそうですか",
    }
  }

  return {
    kind: "continue",
    nextQuestion: "ご連絡先メールを教えてください",
  }
}

function buildSummaryText(jobContext: JobContext, conversationState: ConversationState): string {
  const jobKind = jobContext.jobKind ?? "案件種別未確認"
  const schedule = conversationState.hasDesiredSchedule ? "日程あり" : "日程未定"

  return `${jobKind} / ${jobContext.finalMedium} / ${jobContext.workSite} / ${schedule}`
}

function buildOpenQuestions(conversationState: ConversationState): string[] {
  return [
    conversationState.hasFinalMedium ? undefined : "最終媒体未確認",
    conversationState.hasJobKind ? undefined : "案件種別・尺未確認",
    conversationState.hasAdditionalWork ? undefined : "追加作業未確認",
    conversationState.hasDocumentaryAttachments ? undefined : "付随映像未確認",
    conversationState.hasWorkSite ? undefined : "作業場所未確認",
    conversationState.hasReferenceUrls ? undefined : "参考URL未確認",
    conversationState.hasDesiredSchedule ? undefined : "作業・立ち会い日程未確認",
  ].filter((item): item is string => Boolean(item))
}

function shouldPrioritizeSchedule(
  jobContext: JobContext,
  conversationState: ConversationState,
): boolean {
  return (
    conversationState.hasDesiredSchedule &&
    conversationState.hasJobKind &&
    (conversationState.hasFinalMedium || jobContext.finalMedium === "web") &&
    isOneHourCandidateJob(jobContext)
  )
}

function isOneHourCandidateJob(jobContext: JobContext): boolean {
  return (
    jobContext.finalMedium === "web" ||
    jobContext.finalMedium === "vertical-sns" ||
    jobContext.jobKind === "cm-30s" ||
    jobContext.jobKind === "mv-5m" ||
    jobContext.projectLengthMinutes !== undefined
  )
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
      note: "1時間候補",
    }
  })
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
