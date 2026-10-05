import type { ChatbotMessage, ConversationState, JobContext } from "@/lib/chatbot/domain"
import { confirmedBookingDetails, confirmedBookingNote } from "./booking-details"

export type ConsultationSummaryInput = {
  messages?: ReadonlyArray<ChatbotMessage>
  jobContext?: Partial<JobContext>
  conversationState?: Partial<ConversationState>
  fallback?: {
    customerName?: string
    companyName?: string
    contactEmail?: string
    jobKind?: string
    projectLength?: string
    publicReleaseDate?: string
  }
}

export function formatConsultationSummary(input: ConsultationSummaryInput): string {
  const state = input.conversationState ?? {}
  const fallback = input.fallback ?? {}
  const explicitProjectName = input.messages?.filter((message) => message.role === "user").flatMap((message) => message.content.split("\n")).map((line) => /^(?:案件名|作品名)[:：]\s*(.+)$/u.exec(line)?.[1] ?? /^(?:案件名|作品名)は[「『]([^」』]+)[」』](?:です)?[。]?$/u.exec(line)?.[1]).filter(Boolean).at(-1)
  const note = confirmedBookingNote(input.messages ?? [], state.bookingFinalConfirmation?.supplementalNote)
  return [
    "相談サマリ",
    `案件名: ${explicitProjectName ?? "未確認"}`,
    ...confirmedBookingDetails(input).map(({ label, value }) => `${label}: ${value}`),
    ...(note ? [`その他の補足: ${note}`] : []),
    "連絡先:",
    `- 氏名: ${state.customerName ?? fallback.customerName ?? "未確認"}`,
    `- 会社: ${state.companyName ?? fallback.companyName ?? "未確認"}`,
    `- メール: ${state.contactEmail ?? fallback.contactEmail ?? "未確認"}`,
  ].join("\n")
}

/** Booking facts retain their customer evidence, independently of workflow estimates. */
export function buildBookingConfirmationItems(input: ConsultationSummaryInput): Array<{ label: string; value: string }> {
  return confirmedBookingDetails(input)
}

export function hasRequiredConsultationNotificationSlots(input: {
  conversationState?: Partial<ConversationState>
}): boolean {
  const state = input.conversationState ?? {}
  return Boolean(
    state.hasFinalMedium &&
      state.hasJobKind &&
      state.hasProjectLength &&
      state.hasDeliveryFormat &&
      state.hasMaterialTiming &&
      state.hasWorkSite &&
      state.hasDesiredSchedule &&
      state.hasContactEmail &&
      state.contactEmail,
  )
}

export function hasRequiredEmailConsultationSlots(input: {
  conversationState?: Partial<ConversationState>
}): boolean {
  const state = input.conversationState ?? {}
  if (state.requestKind === "lecture-training" || state.hasLectureTrainingIntent) {
    return Boolean(
      state.hasLectureTrainingContent &&
        state.hasLectureTrainingVenue &&
        state.hasLectureTrainingSoftware &&
        state.hasResolveVersion &&
        state.hasControlPanel &&
        state.hasAudienceGuiDisplay &&
        state.hasInstructorMonitorSetup &&
        state.hasPreferredLectureSchedule &&
        state.hasContactEmail &&
        state.contactEmail,
    )
  }

  return Boolean(
    state.hasFinalMedium &&
      state.hasJobKind &&
      state.hasProjectLength &&
      state.hasDeliveryFormat &&
      state.hasMaterialTiming &&
      state.hasWorkSite &&
      state.hasContactEmail &&
      state.contactEmail,
  )
}
