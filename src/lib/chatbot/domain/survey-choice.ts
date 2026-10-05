import type { JobKind } from "./workflow-estimate"
import { getProjectConditionDefinition, projectConditionDefinitions, type ConditionInput, type ConditionVisibility } from "@/lib/booking/domain/project-conditions"

export type SurveyChoice = { id: string; label: string }
export type SurveyChoiceSet = {
  id: string
  question: string
  choices: SurveyChoice[]
  input?: ConditionInput
  visibility?: ConditionVisibility
  selectionMode?: "single" | "multiple"
  allowFreeText?: boolean
}
export function conditionChoiceSet(id: string): SurveyChoiceSet {
  const definition = getProjectConditionDefinition(id)
  if (!definition) throw new Error(`Unknown project condition: ${id}`)
  return { id: definition.id, question: definition.question, choices: [...definition.options], input: definition.input, ...(definition.visibility ? { visibility: definition.visibility } : {}), ...(definition.input === "multiple" ? { selectionMode: "multiple" as const } : {}), ...(definition.allowFreeText ? { allowFreeText: true } : {}) }
}

export const jobKindChoices = conditionChoiceSet("job-kind")
export const projectLengthChoices = conditionChoiceSet("project-length")
export const finalMediumChoices = conditionChoiceSet("final-medium")
export const additionalWorkChoices = conditionChoiceSet("additional-work")
export const documentaryAttachmentChoices = conditionChoiceSet("documentary-attachment")
export const workSiteChoices = conditionChoiceSet("work-site")
export const lectureTrainingContentChoices = conditionChoiceSet("lecture-training-content")
export const lectureTrainingFormatChoices = conditionChoiceSet("lecture-training-format")
export const lectureTrainingSoftwareChoices = conditionChoiceSet("lecture-training-software")
export const productionOptionChoices = conditionChoiceSet("production-options")
export const bookingFinalConfirmationChoices = conditionChoiceSet("booking-final-confirmation")
export const materialTimingChoices = conditionChoiceSet("material-timing")
export const deliveryFormatChoices = conditionChoiceSet("delivery-format")
export const dcpRequiredChoices = conditionChoiceSet("dcp-required")
export const dcpCreatorChoices = conditionChoiceSet("dcp-creator")
export const referenceUrlChoices = conditionChoiceSet("reference-urls")
export const retouchCutCountChoices = conditionChoiceSet("retouch-cut-count")
export function projectLengthChoicesForJobKind(jobKind: JobKind | undefined): SurveyChoiceSet { void jobKind; return projectLengthChoices }
export function customerFacingWorkSiteChoices(now: Date = new Date()): SurveyChoiceSet { void now; return workSiteChoices }
export const surveyChoiceSets = projectConditionDefinitions.map(({ id }) => conditionChoiceSet(id))
