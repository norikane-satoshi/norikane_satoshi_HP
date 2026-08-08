import type { ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  bookingFinalConfirmationChoices,
  customerFacingWorkSiteChoices,
  documentaryAttachmentChoices,
  finalMediumChoices,
  jobKindChoices,
  projectLengthChoicesForJobKind,
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
import { buildBookingFinalConfirmationQuestion } from "@/lib/chatbot/server/flow-policy"
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

  return continueDecision({ conversationState, jobContext, now: input.now })
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
  const baseline =
    workflowEstimate?.estimateStatus === "needs-confirmation"
      ? `ライブ150分超の暫定上限目安は${formatDays(
          workflowEstimate.referenceMinDays ?? workflowEstimate.totalMinDays,
        )}〜${formatDays(
          workflowEstimate.referenceMaxDays ?? workflowEstimate.totalMaxDays,
        )}日です。素材量・カメラ数・ぼかし箇所・チェック体制を確認して判断します。`
      : workflowEstimate
        ? `通常は正本ライン ${formatDays(workflowEstimate.totalMinDays)}〜${formatDays(
            workflowEstimate.totalMaxDays,
          )}日が目安です。`
        : "通常の正本ラインを目安にします。"

  return [
    baseline,
    "希望日数内でも、内容・素材状況・空き状況によって調整できる可能性があるため、条件を整理して相談できます。",
    "ただし、この場では確約せず、空き状況・内容確認・本人確認後に判断します。",
    "送信前に整理内容を確認して、ご連絡先のメールアドレスを必ず添えてください。",
  ].join("")
}

function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "")
}

function continueDecision(input: {
  conversationState: ConversationState
  jobContext: JobContext
  now?: Date
}): RoutingDecision {
  const { conversationState, jobContext, now } = input
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
      presentChoices: customerFacingWorkSiteChoices(now),
    }
  }

  if (!conversationState.hasMaterialDetails || !conversationState.materialHandoff?.contents) {
    return {
      kind: "continue",
      nextQuestion:
        "何の素材をお送りいただく予定ですか？（例: ProRes書き出し、撮影素材一式、使用するクリップのみ）",
    }
  }

  if (!conversationState.hasMaterialTiming || !conversationState.materialHandoff?.timing) {
    return {
      kind: "continue",
      nextQuestion: "その素材は、いつお送りいただけそうですか？未定の場合は「未定」とお答えください。",
    }
  }

  if (!conversationState.hasMaterialHandoff || !conversationState.materialHandoff?.method) {
    return {
      kind: "continue",
      nextQuestion:
        "素材の受け渡し方法を教えてください。（例: SSD / HDDをバイク便・郵送・手渡し、アップローダーで共有）",
    }
  }

  if (!conversationState.hasReferenceUrls) {
    return {
      kind: "continue",
      nextQuestion: "事前に把握しておきたい参考URLがあれば教えてください",
    }
  }

  if (!conversationState.hasContactEmail || !conversationState.contactEmail) {
    return {
      kind: "continue",
      nextQuestion: "ご連絡先メールを教えてください",
    }
  }

  return {
    kind: "continue",
    nextQuestion: buildBookingFinalConfirmationQuestion(jobContext, conversationState),
    presentChoices: bookingFinalConfirmationChoices,
  }
}
