import type { ConversationState, JobContext, RoutingDecision, WorkflowEstimate } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  bookingFinalConfirmationChoices,
  formatConsultationSummary,
  customerFacingWorkSiteChoices,
  documentaryAttachmentChoices,
  finalMediumChoices,
  jobKindChoices,
  materialTimingChoices,
  deliveryFormatChoices,
  dcpRequiredChoices,
  dcpCreatorChoices,
  projectLengthChoicesForJobKind,
  referenceUrlChoices,
} from "@/lib/chatbot/domain"
import {
  tightDeadlineThresholdDays,
  tightishDeadlineMaxDays,
} from "@/lib/chatbot/knowledge/workflow-duration"
import { directContactPolicyMessage } from "@/lib/chatbot/knowledge/forbidden-topics"
import { detectProtectiveTopic } from "@/lib/chatbot/server/protective-topics"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"
import {
  decideLectureTrainingRouting,
  isLectureTrainingInquiry,
} from "@/lib/chatbot/server/lecture-training"
import { buildBookingFinalConfirmationQuestion, desiredScheduleQuestion } from "@/lib/chatbot/server/flow-policy"
import type { ChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"

export type RoutingDecisionInput = {
  jobContext: JobContext
  conversationState: ConversationState
  latestUserMessage?: string
  knowledgeSnapshot?: ChatbotKnowledgeSnapshot | null
  now?: Date
}

export function decideRoutingFallback(input: RoutingDecisionInput): RoutingDecision {
  const { jobContext, conversationState } = input
  if (isLectureTrainingInquiry(conversationState)) {
    return decideLectureTrainingRouting({ jobContext, conversationState })
  }

  const estimate = jobContext.jobKind
    ? estimateWorkflow(jobContext, { knowledgeSnapshot: input.knowledgeSnapshot })
    : undefined

  if (estimate?.requiresDirectContact) return directContact("heavy-retouch")

  if (
    conversationState.daysUntilStart !== undefined &&
    conversationState.daysUntilStart <= tightDeadlineThresholdDays
  ) {
    return directContact("tight-deadline", { workflowEstimate: estimate })
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
  if (conversationState.lookDecomposerDetail) return directContact("plugin-detail")
  if (conversationState.technicalQuestion) return directContact("tech-question")
  if (conversationState.workReviewRequest) return directContact("review-request")
  if (conversationState.outOfScope) return directContact("out-of-scope")

  // Explicit state wins, but nothing on the server ever sets those flags. Without this the whole
  // protective block was unreachable and only the system prompt kept these topics out of an answer.
  const protectiveTopic = detectProtectiveTopic(input.latestUserMessage)
  if (protectiveTopic) return directContact(protectiveTopic, jobContext)

  return continueDecision({ conversationState, jobContext, estimate, now: input.now })
}

function directContact(
  reason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"],
  options: Pick<JobContext, "workflowEstimate"> = {},
) {
  return {
    kind: "to-direct-contact",
    reason,
    requireEmail: true,
    suggestedMessage:
      reason === "tight-deadline"
        ? buildTightDeadlineConsultationMessage(options.workflowEstimate)
        : directContactPolicyMessage,
  } as const
}

function buildTightDeadlineConsultationMessage(workflowEstimate: JobContext["workflowEstimate"]): string {
  void workflowEstimate
  return "希望納期・内容・素材状況・空き状況を整理して則兼本人と相談できます。この場では確約せず、本人確認後に判断します。ご連絡先のメールアドレスを必ず添えてください。"
}

function continueDecision(input: {
  conversationState: ConversationState
  jobContext: JobContext
  estimate?: WorkflowEstimate
  now?: Date
}): RoutingDecision {
  const { conversationState, jobContext, estimate, now } = input
  if (!conversationState.hasJobKind) {
    return {
      kind: "continue",
      nextQuestion: "まず案件種別を選んでください",
      presentChoices: jobKindChoices,
    }
  }

  if (!conversationState.hasProjectLength) {
    const presentChoices = projectLengthChoicesForJobKind(jobContext.jobKind)
    return {
      kind: "continue",
      nextQuestion: presentChoices.question,
      presentChoices,
    }
  }

  if (!conversationState.hasFinalMedium) {
    return {
      kind: "continue",
      nextQuestion: "最終媒体は何になりますか？",
      presentChoices: finalMediumChoices,
    }
  }

  if (!conversationState.hasDeliveryFormat) {
    return { kind: "continue", nextQuestion: deliveryFormatChoices.question, presentChoices: deliveryFormatChoices }
  }
  const cinema = conversationState.finalMedia?.includes("cinema") || jobContext.finalMedium === "cinema"
  if (cinema && !conversationState.hasDcpRequirement) {
    return { kind: "continue", nextQuestion: dcpRequiredChoices.question, presentChoices: dcpRequiredChoices }
  }
  if (cinema && conversationState.dcpRequirement === "required" && !conversationState.hasDcpCreator) {
    return { kind: "continue", nextQuestion: dcpCreatorChoices.question, presentChoices: dcpCreatorChoices }
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
      nextQuestion: customerFacingWorkSiteChoices(now).question,
      presentChoices: customerFacingWorkSiteChoices(now),
    }
  }

  if (!conversationState.hasMaterialTiming || !conversationState.materialHandoff?.timing) {
    return {
      kind: "continue",
      nextQuestion: materialTimingChoices.question,
      presentChoices: materialTimingChoices,
    }
  }

  if (!conversationState.hasReferenceUrls) {
    return {
      kind: "continue",
      nextQuestion: referenceUrlChoices.question,
      presentChoices: referenceUrlChoices,
    }
  }

  if (!conversationState.hasContactEmail || !conversationState.contactEmail) {
    return {
      kind: "continue",
      nextQuestion: "ご連絡先メールを教えてください",
    }
  }

  if (!conversationState.hasDesiredSchedule && conversationState.bookingFinalConfirmation?.status !== "confirmed") {
    return {
      kind: "continue",
      nextQuestion: desiredScheduleQuestion,
    }
  }

  // Unsupported job kinds use the consultation summary after confirmation.
  if (!jobContext.jobKind && conversationState.bookingFinalConfirmation?.status === "confirmed") {
    return consultationEmailDecision(jobContext, conversationState)
  }
  // Confirmed: the handler shows the booking card (it needs the calendar lookup the routing lacks).
  if (conversationState.bookingFinalConfirmation?.status === "confirmed") {
    return { kind: "continue", nextQuestion: "候補日を確認しました。下の予約カードから日程を選んでください。" }
  }

  return {
    kind: "continue",
    nextQuestion: buildBookingFinalConfirmationQuestion(estimate ? { ...jobContext, workflowEstimate: estimate } : jobContext, conversationState),
    presentChoices: bookingFinalConfirmationChoices,
  }
}

function consultationEmailDecision(jobContext: JobContext, conversationState: ConversationState): RoutingDecision {
  const requestLabel = conversationState.otherChoiceComments?.["job-kind"]?.trim()
  const summaryText = formatConsultationSummary({ jobContext, conversationState })
    .split("\n")
    .slice(1)
    .filter((line) => !line.endsWith(":"))
    .map((line) => line.replace(/^- /u, ""))
    .join(" / ")
  return {
    kind: "to-email",
    summary: {
      subject: requestLabel ? `映像制作のご相談（${requestLabel}）` : "映像制作のご相談",
      customerEmail: conversationState.contactEmail ?? "",
      ...(conversationState.customerName ? { customerName: conversationState.customerName } : {}),
      ...(conversationState.companyName ? { companyName: conversationState.companyName } : {}),
      jobContext,
      summaryText,
      openQuestions: ["定型外の案件種別のため、作業期間と日程は則兼本人が確認"],
    },
  }
}
