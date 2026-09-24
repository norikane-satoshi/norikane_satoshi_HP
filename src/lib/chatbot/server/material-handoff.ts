import type { ChatbotMessage, ConversationState } from "@/lib/chatbot/domain"

const materialContentsQuestionPattern = /何の素材|どの素材|どのような素材|素材の内容/u
const materialTimingQuestionPattern = /素材.{0,24}(?:いつ|時期)|いつ.{0,24}素材/u
const materialMethodQuestionPattern = /素材.{0,24}(?:受け渡し方法|どの方法|どういう方法|どのような方法|どう送)|(?:受け渡し方法|どの方法|どういう方法).{0,24}素材/u

export function isMaterialHandoffQuestion(message: string | undefined): boolean {
  if (!message) return false
  return (
    materialContentsQuestionPattern.test(message) ||
    materialTimingQuestionPattern.test(message) ||
    materialMethodQuestionPattern.test(message)
  )
}

export function applyMaterialHandoffAnswer(input: {
  conversationState: ConversationState
  previousAssistantMessage?: string
  latestUserMessage: string
}): ConversationState {
  const answer = normalizeMaterialAnswer(input.latestUserMessage)
  if (!answer || !input.previousAssistantMessage) return input.conversationState

  const materialHandoff = { ...(input.conversationState.materialHandoff ?? {}) }
  if (materialContentsQuestionPattern.test(input.previousAssistantMessage)) {
    materialHandoff.contents = answer
    return {
      ...input.conversationState,
      hasMaterialDetails: true,
      materialHandoff,
    }
  }
  if (materialTimingQuestionPattern.test(input.previousAssistantMessage)) {
    materialHandoff.timing = answer
    return {
      ...input.conversationState,
      hasMaterialTiming: true,
      materialHandoff,
    }
  }
  if (materialMethodQuestionPattern.test(input.previousAssistantMessage)) {
    materialHandoff.method = answer
    return {
      ...input.conversationState,
      hasMaterialHandoff: true,
      materialHandoff,
    }
  }

  return input.conversationState
}

export function recoverMaterialHandoffFromHistory(
  messages: readonly ChatbotMessage[],
  conversationState: Partial<ConversationState>,
): ConversationState {
  let recovered: ConversationState = {
    hasFinalMedium: false,
    hasJobKind: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    turnCount: 0,
    ...conversationState,
  }
  let previousAssistantMessage: string | undefined

  for (const message of messages) {
    if (message.role === "assistant") {
      previousAssistantMessage = message.content
      continue
    }
    if (message.role !== "user") continue
    recovered = applyMaterialHandoffAnswer({
      conversationState: recovered,
      previousAssistantMessage,
      latestUserMessage: message.content,
    })
  }

  return recovered
}

function normalizeMaterialAnswer(value: string): string | undefined {
  const lines = value.normalize("NFKC").split(/\r?\n/u)
  const selected = lines.find((line) => /^\s*選択\s*[:：]/u.test(line))
  const otherComment = lines
    .map((line) => line.match(/^\s*その他(?:コメント|の内容)?\s*[:：]\s*(.+)$/u)?.[1]?.trim())
    .find(Boolean)
  // A panel answer arrives as "選択: <labels>" plus an optional "その他コメント: <text>" line.
  // Store what the customer actually chose, and the comment itself when only "その他" was picked.
  const answer = selected
    ? (() => {
        const labels = selected.replace(/^\s*選択\s*[:：]\s*/u, "").split(/[、,]/u).map((label) => label.trim()).filter(Boolean)
        const concrete = labels.filter((label) => label !== "その他")
        if (otherComment) return [...concrete, otherComment].join("、")
        return labels.join("、")
      })()
    : value.normalize("NFKC")
  const normalized = answer.replace(/\s+/gu, " ").trim()
  return normalized ? normalized.slice(0, 500) : undefined
}
