import type { SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import { getLocalizedCopy } from "./copy"

type SurveyChoiceCopyKey = keyof ReturnType<typeof surveyChoiceCopy>

function surveyChoiceCopy(locale: string) {
  return getLocalizedCopy(locale, "SurveyChoices")
}

function resolveCopyKey(choiceSet: SurveyChoiceSet): SurveyChoiceCopyKey | null {
  if (choiceSet.id === "job-kind") return "jobKind"
  if (choiceSet.id === "final-medium") return "finalMedium"
  if (choiceSet.id === "additional-work") return "additionalWork"
  if (choiceSet.id === "documentary-attachment") return "documentaryAttachment"
  if (choiceSet.id === "work-site") return "workSite"
  if (choiceSet.id === "lecture-training-content") return "trainingContent"
  if (choiceSet.id === "lecture-training-format") return "trainingFormat"
  if (choiceSet.id === "lecture-training-software") return "trainingSoftware"
  if (choiceSet.id === "production-options") return "productionOptions"
  if (choiceSet.id === "booking-final-confirmation") return "bookingConfirmation"
  if (choiceSet.id !== "project-length") return null

  const firstChoiceId = choiceSet.choices[0]?.id ?? ""
  if (firstChoiceId.startsWith("cm-length-")) return "cmLength"
  if (firstChoiceId.startsWith("mv-length-")) return "mvLength"
  if (firstChoiceId.startsWith("drama-episode-")) return "dramaLength"
  if (firstChoiceId.startsWith("live-length-")) return "liveLength"
  if (firstChoiceId.startsWith("feature-length-")) return "featureLength"
  if (firstChoiceId.startsWith("vertical-length-")) return "verticalLength"
  return "projectLength"
}

export function localizeSurveyChoiceSet(choiceSet: SurveyChoiceSet, locale: string): SurveyChoiceSet {
  const key = resolveCopyKey(choiceSet)
  if (!key) return choiceSet
  const localized = surveyChoiceCopy(locale)[key]
  const labels = localized.choices as Record<string, string>
  return {
    ...choiceSet,
    question: localized.question,
    choices: choiceSet.choices.map((choice) => ({
      ...choice,
      label: labels[choice.id] ?? choice.label,
    })),
  }
}
