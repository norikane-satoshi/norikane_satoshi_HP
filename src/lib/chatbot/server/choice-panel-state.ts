import type {
  ConversationState,
  DocumentaryAttachment,
  JobContext,
  SurveyChoice,
  SurveyChoiceSet,
  WorkSite,
} from "@/lib/chatbot/domain"

type ChoicePanelPatch = {
  choiceSetId: SurveyChoiceSet["id"]
  choiceId: SurveyChoice["id"]
  choiceIds: SurveyChoice["id"][]
  conversationState: Partial<ConversationState>
  jobContext: Partial<JobContext>
}

const choicePrefixPattern = /^\s*選択\s*[:：]\s*/u

export function applyActiveChoiceAnswer(input: {
  activeChoices?: SurveyChoiceSet
  message: string
}): ChoicePanelPatch | null {
  const choices = resolveChoices(input.activeChoices, input.message)
  const choice = choices[0]
  if (!input.activeChoices || !choice) return null

  switch (input.activeChoices.id) {
    case "final-medium":
      return {
        choiceSetId: input.activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: { hasFinalMedium: true },
        jobContext: { finalMedium: choice.id as JobContext["finalMedium"] },
      }
    case "additional-work":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: input.activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: { hasAdditionalWork: true },
          jobContext: { additionalWork: undefined },
        }
      }

      return {
        choiceSetId: input.activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: { hasAdditionalWork: true },
        jobContext: { additionalWork: choices.map((item) => item.id as AdditionalWork) },
      }
    case "documentary-attachment":
      return {
        choiceSetId: input.activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: { hasDocumentaryAttachments: true },
        jobContext: { documentaryAttachment: toDocumentaryAttachment(choice.id) },
      }
    case "work-site":
      return {
        choiceSetId: input.activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: { hasWorkSite: true },
        jobContext: { workSite: toWorkSite(choice.id) },
      }
    default:
      return null
  }
}

export function isSatisfiedChoicePanel(
  choiceSet: SurveyChoiceSet | undefined,
  conversationState: ConversationState,
): boolean {
  switch (choiceSet?.id) {
    case "final-medium":
      return conversationState.hasFinalMedium
    case "additional-work":
      return conversationState.hasAdditionalWork
    case "documentary-attachment":
      return conversationState.hasDocumentaryAttachments
    case "work-site":
      return conversationState.hasWorkSite
    default:
      return false
  }
}

function resolveChoices(activeChoices: SurveyChoiceSet | undefined, message: string): SurveyChoice[] {
  if (!activeChoices) return []
  const normalizedMessages = message
    .replace(choicePrefixPattern, "")
    .split(/[,、\n]/u)
    .map(normalizeChoiceText)
    .filter(Boolean)
  const messages = normalizedMessages.length > 0 ? normalizedMessages : [normalizeChoiceText(message)]

  return messages
    .map((normalizedMessage) =>
      activeChoices.choices.find((choice) => normalizeChoiceText(choice.id) === normalizedMessage) ??
      activeChoices.choices.find((choice) => normalizeChoiceText(choice.label) === normalizedMessage) ??
      null,
    )
    .filter((choice): choice is SurveyChoice => Boolean(choice))
}

type AdditionalWork = NonNullable<JobContext["additionalWork"]>[number]

function toDocumentaryAttachment(choiceId: string): DocumentaryAttachment {
  if (choiceId === "none") return { kind: "none" }
  if (choiceId === "digest" || choiceId === "interview" || choiceId === "bonus" || choiceId === "making") {
    return { kind: choiceId, count: 1 }
  }
  return { kind: "other", count: 1, note: choiceId }
}

function toWorkSite(choiceId: string): WorkSite {
  if (choiceId === "satoshi-studio" || choiceId === "remote-grading") return choiceId
  if (choiceId === "client-facility-attended" || choiceId === "on-site-post-production") return "on-site"
  return "remote-grading"
}

function normalizeChoiceText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ")
}
