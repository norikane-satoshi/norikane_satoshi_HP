import type {
  ConversationState,
  DocumentaryAttachment,
  DocumentaryAttachmentItem,
  JobContext,
  JobKind,
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
const otherCommentPrefixPattern = /^\s*その他(?:コメント|の内容)?\s*[:：]\s*/u

export function applyActiveChoiceAnswer(input: {
  activeChoices?: SurveyChoiceSet
  message: string
}): ChoicePanelPatch | null {
  const choices = resolveChoices(input.activeChoices, input.message)
  const choice = choices[0]
  if (!input.activeChoices || !choice) return null
  const activeChoices = input.activeChoices
  const otherCommentPatch = toOtherChoiceCommentPatch(input.activeChoices, choices, input.message)

  switch (activeChoices.id) {
    case "job-kind":
      return applyJobKindChoice(activeChoices, choice, otherCommentPatch)
    case "project-length":
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: {
          hasProjectLength: true,
          ...otherCommentPatch,
        },
        jobContext: toProjectLengthJobContext(choice.id),
      }
    case "final-medium":
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: { hasFinalMedium: true, ...otherCommentPatch },
        jobContext: { finalMedium: choice.id as JobContext["finalMedium"] },
      }
    case "additional-work":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: { hasAdditionalWork: true },
          jobContext: { additionalWork: undefined },
        }
      }

      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: { hasAdditionalWork: true, ...otherCommentPatch },
        jobContext: { additionalWork: choices.map((item) => item.id as AdditionalWork) },
      }
    case "documentary-attachment":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: { hasDocumentaryAttachments: true },
          jobContext: { documentaryAttachment: { kind: "none" } },
        }
      }

      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: { hasDocumentaryAttachments: true, ...otherCommentPatch },
        jobContext: {
          documentaryAttachment: toDocumentaryAttachment(
            choices.map((item) => item.id),
            otherCommentPatch.otherChoiceComments?.[activeChoices.id],
          ),
        },
      }
    case "work-site":
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: { hasWorkSite: true, ...otherCommentPatch },
        jobContext: { workSite: toWorkSite(choice.id) },
      }
    case "lecture-training-content":
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: {
          requestKind: "lecture-training",
          hasLectureTrainingIntent: true,
          hasLectureTrainingContent: true,
          requiresNorikaneConfirmation: true,
          lectureTrainingInquiry: {
            content: choices
              .map((item) => labelChoice(activeChoices, item.id))
              .join(" / "),
          },
          ...otherCommentPatch,
        },
        jobContext: {},
      }
    case "lecture-training-format":
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: {
          requestKind: "lecture-training",
          hasLectureTrainingIntent: true,
          hasLectureTrainingVenue: true,
          requiresNorikaneConfirmation: true,
          lectureTrainingInquiry: {
            venue: labelChoice(activeChoices, choice.id),
          },
          ...otherCommentPatch,
        },
        jobContext: {},
      }
    case "lecture-training-software":
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: {
          requestKind: "lecture-training",
          hasLectureTrainingIntent: true,
          hasLectureTrainingSoftware: true,
          requiresNorikaneConfirmation: true,
          lectureTrainingInquiry: {
            software:
              choice.id === "davinci-resolve-studio" || choice.id === "davinci-resolve"
                ? choice.id
                : undefined,
            ...(choice.id === "other" ? { unsupportedSoftware: "その他" } : {}),
          },
          ...otherCommentPatch,
        },
        jobContext: {},
      }
    case "production-options":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: { hasProductionOptions: true, productionOptions: [] },
          jobContext: {},
        }
      }

      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: {
          hasProductionOptions: true,
          productionOptions: choices.map((item) => item.id as ProductionOption),
          ...otherCommentPatch,
        },
        jobContext: {},
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
    case "job-kind":
      return conversationState.hasJobKind
    case "project-length":
      return Boolean(conversationState.hasProjectLength)
    case "final-medium":
      return conversationState.hasFinalMedium
    case "additional-work":
      return conversationState.hasAdditionalWork
    case "documentary-attachment":
      return conversationState.hasDocumentaryAttachments
    case "work-site":
      return conversationState.hasWorkSite
    case "lecture-training-content":
      return Boolean(conversationState.hasLectureTrainingContent)
    case "lecture-training-format":
      return Boolean(conversationState.hasLectureTrainingVenue)
    case "lecture-training-software":
      return Boolean(conversationState.hasLectureTrainingSoftware)
    case "production-options":
      return Boolean(conversationState.hasProductionOptions)
    default:
      return false
  }
}

function resolveChoices(activeChoices: SurveyChoiceSet | undefined, message: string): SurveyChoice[] {
  if (!activeChoices) return []
  const selectedText = extractSelectedChoiceText(message)
  const normalizedMessages = selectedText
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
type ProductionOption = NonNullable<ConversationState["productionOptions"]>[number]

function applyJobKindChoice(
  choiceSet: SurveyChoiceSet,
  choice: SurveyChoice,
  otherCommentPatch: Pick<ConversationState, "otherChoiceComments"> | Record<string, never>,
): ChoicePanelPatch {
  if (choice.id === "lecture-training") {
    return {
      choiceSetId: choiceSet.id,
      choiceId: choice.id,
      choiceIds: [choice.id],
      conversationState: {
        hasJobKind: true,
        requestKind: "lecture-training",
        hasLectureTrainingIntent: true,
        requiresNorikaneConfirmation: true,
      },
      jobContext: {},
    }
  }

  const mappedJobKind = toKnownJobKind(choice.id)
  return {
    choiceSetId: choiceSet.id,
    choiceId: choice.id,
    choiceIds: [choice.id],
    conversationState: {
      hasJobKind: true,
      ...(mappedJobKind ? {} : { otherChoiceComments: { [choiceSet.id]: labelChoice(choiceSet, choice.id) } }),
      ...otherCommentPatch,
    },
    jobContext: mappedJobKind ? { jobKind: mappedJobKind } : {},
  }
}

function toKnownJobKind(choiceId: string): JobKind | undefined {
  if (
    choiceId === "cm-30s" ||
    choiceId === "mv-5m" ||
    choiceId === "feature-90m" ||
    choiceId === "drama-first" ||
    choiceId === "live-60m" ||
    choiceId === "vertical-60s"
  ) {
    return choiceId
  }
  return undefined
}

function toProjectLengthJobContext(choiceId: string): Partial<JobContext> {
  switch (choiceId) {
    case "short-under-60s":
      return { projectLengthMinutes: 1 }
    case "medium-5m":
      return { projectLengthMinutes: 5 }
    case "long-30m":
      return { projectLengthMinutes: 30 }
    case "feature-90m":
      return { projectLengthMinutes: 90 }
    case "live-60m":
      return { projectLengthMinutes: 60 }
    case "live-150m":
      return { projectLengthMinutes: 150 }
    default:
      return {}
  }
}

function toDocumentaryAttachment(choiceIds: string[], otherComment?: string): DocumentaryAttachment {
  const attachments = choiceIds.map((choiceId) => toDocumentaryAttachmentItem(choiceId, otherComment))
  if (attachments.length === 1) return attachments[0]
  return { kind: "mixed", items: attachments }
}

function toDocumentaryAttachmentItem(choiceId: string, otherComment?: string): DocumentaryAttachmentItem {
  if (choiceId === "digest" || choiceId === "interview" || choiceId === "bonus" || choiceId === "making") {
    return { kind: choiceId, count: 1 }
  }
  return { kind: "other", count: 1, note: otherComment ?? "" }
}

function toWorkSite(choiceId: string): WorkSite {
  if (choiceId === "satoshi-studio" || choiceId === "remote-grading") return choiceId
  if (choiceId === "client-facility-attended" || choiceId === "on-site-post-production") return "on-site"
  return "remote-grading"
}

function labelChoice(choiceSet: SurveyChoiceSet, choiceId: string): string {
  return choiceSet.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId
}

function normalizeChoiceText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ")
}

function extractSelectedChoiceText(message: string): string {
  return message
    .split(/\r?\n/u)
    .find((line) => choicePrefixPattern.test(line)) ?? message
}

function extractOtherComment(message: string): string | undefined {
  const comment = message
    .split(/\r?\n/u)
    .map((line) => line.replace(otherCommentPrefixPattern, "").trim())
    .find((line, index) => otherCommentPrefixPattern.test(message.split(/\r?\n/u)[index]) && line.length > 0)
  return comment
}

function toOtherChoiceCommentPatch(
  activeChoices: SurveyChoiceSet,
  choices: SurveyChoice[],
  message: string,
): Pick<ConversationState, "otherChoiceComments"> | Record<string, never> {
  if (!choices.some((choice) => choice.id === "other")) return {}
  const otherComment = extractOtherComment(message)
  if (!otherComment) return {}
  return { otherChoiceComments: { [activeChoices.id]: otherComment } }
}
