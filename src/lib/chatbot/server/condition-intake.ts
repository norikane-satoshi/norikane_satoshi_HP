import { getProjectConditionDefinition, projectConditionDefinitions, isConditionVisible, type ConditionAnswers, type ProjectConditionDefinition } from "@/lib/booking/domain/project-conditions"
import { conditionChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import type { ConversationState, JobContext, SurveyChoiceSet } from "@/lib/chatbot/domain"

const legacyFlags = {
  "job-kind": "hasJobKind", "project-length": "hasProjectLength", "final-medium": "hasFinalMedium",
  "delivery-format": "hasDeliveryFormat", "dcp-required": "hasDcpRequirement", "dcp-creator": "hasDcpCreator",
  "additional-work": "hasAdditionalWork", "documentary-attachment": "hasDocumentaryAttachments",
  "work-site": "hasWorkSite", "material-timing": "hasMaterialTiming", "reference-urls": "hasReferenceUrls",
  "lecture-training-content": "hasLectureTrainingContent", "lecture-training-format": "hasLectureTrainingVenue",
  "lecture-training-software": "hasLectureTrainingSoftware", "production-options": "hasProductionOptions",
} as const

/** Compatibility facts are used only when the persisted question has no structured answer. */
export function conditionAnswersForState(state: Partial<ConversationState>, jobContext?: Partial<JobContext>): ConditionAnswers {
  if (state.conditionAnswers !== undefined) return { ...state.conditionAnswers }
  const answers: ConditionAnswers = {}
  if (!answers["final-medium"] && (state.hasFinalMedium || (jobContext?.finalMedium && jobContext.finalMedium !== "other"))) {
    const selectedIds = state.finalMedia ?? (jobContext?.finalMedium ? [jobContext.finalMedium] : [])
    if (selectedIds.length) answers["final-medium"] = { selectedIds }
  }
  if (!answers["dcp-required"] && state.dcpRequirement) answers["dcp-required"] = { selectedIds: [state.dcpRequirement] }
  if (!answers["additional-work"] && state.hasAdditionalWork) answers["additional-work"] = { selectedIds: jobContext?.additionalWork ?? ["none"] }
  return answers
}

export function isConditionAnswered(id: string, state: Partial<ConversationState>): boolean {
  const answer = state.conditionAnswers?.[id]
  if (answer) return answer.status === "unknown" || answer.status === "answered"
  if (id === "booking-final-confirmation") return state.bookingFinalConfirmation?.status === "confirmed" || state.bookingFinalConfirmation?.status === "supplemental-received"
  if (state.conditionAnswers !== undefined) return false
  const flag = legacyFlags[id as keyof typeof legacyFlags]
  return flag ? state[flag] === true : false
}

export function missingConditionPanels(state: Partial<ConversationState>, jobContext?: Partial<JobContext>): SurveyChoiceSet[] {
  const answers = conditionAnswersForState(state, jobContext)
  return (projectConditionDefinitions as readonly ProjectConditionDefinition[])
    .filter((definition) => definition.chatIntake && isConditionVisible(definition, answers) && !isConditionAnswered(definition.id, state))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(({ id }) => conditionChoiceSet(id))
}

export function retainConditionAnswers(answers: ConditionAnswers | undefined, messageIds: ReadonlySet<string>): ConditionAnswers {
  return Object.fromEntries(Object.entries(answers ?? {}).filter(([, answer]) => answer.sourceMessageId && messageIds.has(answer.sourceMessageId)))
}

export function visibleConditionAnswers(answers: ConditionAnswers): ConditionAnswers {
  return Object.fromEntries(Object.entries(answers).filter(([id]) => {
    const definition = getProjectConditionDefinition(id)
    return definition && isConditionVisible(definition, answers)
  }))
}
