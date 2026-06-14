import type { ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  documentaryAttachmentChoices,
  finalMediumChoices,
  workSiteChoices,
} from "@/lib/chatbot/domain"
import {
  complexConversationTurnThreshold,
  settledConversationTurnThreshold,
  tightDeadlineThresholdDays,
  tightishDeadlineMaxDays,
} from "@/lib/chatbot/knowledge/workflow-duration"
import { isValidChatbotContactEmail } from "@/lib/chatbot/server/contact-email"
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
  if (conversationState.lookDecomposerDetail) return directContact("plugin-detail")
  if (conversationState.technicalQuestion) return directContact("tech-question")
  if (conversationState.workReviewRequest) return directContact("review-request")
  if (conversationState.outOfScope) return directContact("out-of-scope")
  if (conversationState.turnCount >= complexConversationTurnThreshold) return directContact("complex")

  if (isBookingInlineReady(jobContext, conversationState)) {
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

function isBookingInlineReady(jobContext: JobContext, conversationState: ConversationState): boolean {
  return (
    conversationState.hasDesiredSchedule &&
    conversationState.hasFinalMedium &&
    conversationState.hasJobKind &&
    conversationState.hasContactEmail &&
    isValidChatbotContactEmail(conversationState.contactEmail) &&
    hasBookingContactName(conversationState) &&
    Boolean(jobContext.jobKind) &&
    Boolean(jobContext.preferredStartDate?.trim())
  )
}

function hasBookingContactName(conversationState: ConversationState): boolean {
  return Boolean((conversationState.contactName ?? conversationState.customerName)?.trim())
}

function directContact(reason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]) {
  return {
    kind: "to-direct-contact",
    reason,
    requireEmail: true,
    suggestedMessage:
      "のりかね映像設計室の担当者が直接ご対応いたしますので、ご連絡先を共有いただけますか？",
  } as const
}

function continueDecision(conversationState: ConversationState): RoutingDecision {
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
