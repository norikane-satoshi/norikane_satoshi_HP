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
  for (const key of booleanConversationStateKeys) {
    if (stored[key] === true || inputState[key] === true || activeChoiceState[key] === true || durationState[key] === true) {
      state[key] = true
    }
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
  const intakeClarifications = {
    ...(stored.intakeClarifications ?? {}),
    ...(inputState.intakeClarifications ?? {}),
    ...(activeChoiceState.intakeClarifications ?? {}),
  }
  const bookingFinalConfirmation = {
    ...(stored.bookingFinalConfirmation ?? {}),
    ...(inputState.bookingFinalConfirmation ?? {}),
    ...(activeChoiceState.bookingFinalConfirmation ?? {}),
  }
  const bookingReadiness = {
    ...(stored.bookingReadiness ?? {}),
    ...(inputState.bookingReadiness ?? {}),
    ...(activeChoiceState.bookingReadiness ?? {}),
  }
  const bookingSubmission = {
    ...(stored.bookingSubmission ?? {}),
    ...(inputState.bookingSubmission ?? {}),
    ...(activeChoiceState.bookingSubmission ?? {}),
  }
  const hasSubmittedBooking = bookingSubmission.status === "submitted" && bookingSubmission.reservationNumber
  const mergedBookingFinalConfirmation = !hasSubmittedBooking && bookingFinalConfirmation.status
    ? { bookingFinalConfirmation: bookingFinalConfirmation as NonNullable<ConversationState["bookingFinalConfirmation"]> }
    : {}
  const mergedBookingSubmission =
    hasSubmittedBooking
      ? { bookingSubmission: bookingSubmission as NonNullable<ConversationState["bookingSubmission"]> }
      : {}
  if (hasSubmittedBooking) {
    delete state.bookingFinalConfirmation
  }

  return {
    ...state,
    ...(Object.keys(otherChoiceComments).length > 0 ? { otherChoiceComments } : {}),
    ...(Object.keys(lectureTrainingInquiry).length > 0 ? { lectureTrainingInquiry } : {}),
    ...(Object.keys(intakeClarifications).length > 0 ? { intakeClarifications } : {}),
    ...mergedBookingFinalConfirmation,
    ...mergedBookingSubmission,
    ...(Object.keys(bookingReadiness).length > 0 ? { bookingReadiness } : {}),
    ...(input.jobContext.finalMedium !== "other" ? { hasFinalMedium: true } : {}),
    ...(input.jobContext.jobKind ? { hasJobKind: true } : {}),
    ...(typeof input.jobContext.projectLengthMinutes === "number" ? { hasProjectLength: true } : {}),
  }
}

const booleanConversationStateKeys = [
  "hasFinalMedium",
  "hasJobKind",
  "hasProjectLength",
  "hasMaterialHandoff",
  "hasMaterialDetails",
  "hasAdditionalWork",
  "hasDocumentaryAttachments",
  "hasWorkSite",
  "hasReferenceUrls",
  "hasDeliveryFormat",
  "hasProductionOptions",
  "hasBudgetRange",
  "hasContactEmail",
  "hasDesiredSchedule",
  "hasCustomerIdentity",
  "hasLectureTrainingIntent",
  "hasLectureTrainingContent",
  "hasLectureTrainingVenue",
  "hasLectureTrainingSoftware",
  "hasResolveVersion",
  "hasControlPanel",
  "hasAudienceGuiDisplay",
  "hasInstructorMonitorSetup",
  "hasPreferredLectureSchedule",
] as const satisfies readonly (keyof ConversationState)[]

export function deriveUserTurnCount(
  history: readonly ChatbotMessage[],
  currentMessage: ChatbotMessage,
): number {
  return (
    history.filter((message) => message.role === "user").length +
    (currentMessage.role === "user" ? 1 : 0)
  )
}
