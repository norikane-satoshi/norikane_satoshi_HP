import type { ChatbotConversation, ChatbotMessage, ConversationState, JobContext } from "@/lib/chatbot/domain"

export function buildConversationState(input: {
  conversation: ChatbotConversation
  userMessage: ChatbotMessage
  inputConversationState?: Partial<ConversationState>
  activeChoiceConversationState?: Partial<ConversationState>
  jobContext: JobContext
  durationStatePatch?: Partial<ConversationState>
}): ConversationState {
  const userTurnCount = deriveUserTurnCount(input.conversation.messages, input.userMessage)
  const stored = input.conversation.context.conversationState ?? {}
  const inputState = input.inputConversationState ?? {}
  const activeChoiceState = input.activeChoiceConversationState ?? {}
  const durationState = input.durationStatePatch ?? {}

  const state: ConversationState = {
    hasFinalMedium: false,
    hasJobKind: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    ...stored,
    ...inputState,
    ...activeChoiceState,
    ...durationState,
    turnCount: userTurnCount,
  }
  const otherChoiceComments = {
    ...(stored.otherChoiceComments ?? {}),
    ...(inputState.otherChoiceComments ?? {}),
    ...(activeChoiceState.otherChoiceComments ?? {}),
  }
  const lectureTrainingInquiry = {
    ...(stored.lectureTrainingInquiry ?? {}),
    ...(inputState.lectureTrainingInquiry ?? {}),
    ...(activeChoiceState.lectureTrainingInquiry ?? {}),
  }

  return {
    ...state,
    ...(Object.keys(otherChoiceComments).length > 0 ? { otherChoiceComments } : {}),
    ...(Object.keys(lectureTrainingInquiry).length > 0 ? { lectureTrainingInquiry } : {}),
    ...(input.jobContext.finalMedium !== "other" ? { hasFinalMedium: true } : {}),
    ...(input.jobContext.jobKind ? { hasJobKind: true } : {}),
    ...(typeof input.jobContext.projectLengthMinutes === "number" ? { hasProjectLength: true } : {}),
  }
}

export function deriveUserTurnCount(
  history: readonly ChatbotMessage[],
  currentMessage: ChatbotMessage,
): number {
  return (
    history.filter((message) => message.role === "user").length +
    (currentMessage.role === "user" ? 1 : 0)
  )
}
