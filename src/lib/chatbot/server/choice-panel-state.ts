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
const noChoiceIds = new Set(["none"])
const undecidedChoiceIds = new Set(["undecided"])

export function applyActiveChoiceAnswer(input: {
  activeChoices?: SurveyChoiceSet
  message: string
  activeIntakeClarification?: ConversationState["activeIntakeClarification"]
}): ChoicePanelPatch | null {
  const clarifiedPatch = applyPendingClarificationAnswer(input.activeChoices, input.activeIntakeClarification, input.message)
  if (clarifiedPatch) return clarifiedPatch

  const choices = resolveChoices(input.activeChoices, input.message)
  const choice = choices[0]
  if (!input.activeChoices || !choice) {
    return buildUnmatchedChoiceClarification(input.activeChoices, input.message)
  }
  const activeChoices = input.activeChoices
  const otherCommentPatch = toOtherChoiceCommentPatch(input.activeChoices, choices, input.message)
  const clarification = assessChoiceAnswerClarity(activeChoices, choices, input.message, otherCommentPatch)
  if (clarification) return clarification

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
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          ...toUnknownChoicePatch(activeChoices, choices, input.message),
        },
        jobContext: toProjectLengthJobContext(choice.id),
      }
    case "final-medium":
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: {
          hasFinalMedium: true,
          ...otherCommentPatch,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
        jobContext: { finalMedium: choice.id as JobContext["finalMedium"] },
      }
    case "additional-work":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: {
            hasAdditionalWork: true,
            ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          },
          jobContext: { additionalWork: undefined },
        }
      }

      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: {
          hasAdditionalWork: true,
          ...otherCommentPatch,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
        jobContext: { additionalWork: choices.map((item) => item.id as AdditionalWork) },
      }
    case "documentary-attachment":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: {
            hasDocumentaryAttachments: true,
            ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          },
          jobContext: { documentaryAttachment: { kind: "none" } },
        }
      }

      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: {
          hasDocumentaryAttachments: true,
          ...otherCommentPatch,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
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
        conversationState: {
          hasWorkSite: true,
          ...otherCommentPatch,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          ...toUnknownChoicePatch(activeChoices, choices, input.message),
        },
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
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
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
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          ...toUnknownChoicePatch(activeChoices, choices, input.message),
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
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
        jobContext: {},
      }
    case "production-options":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: {
            hasProductionOptions: true,
            productionOptions: [],
            ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          },
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
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
        jobContext: {},
      }
    default:
      return null
  }
}

function assessChoiceAnswerClarity(
  activeChoices: SurveyChoiceSet,
  choices: SurveyChoice[],
  message: string,
  otherCommentPatch: Pick<ConversationState, "otherChoiceComments"> | Record<string, never>,
): ChoicePanelPatch | null {
  if (activeChoices.selectionMode === "multiple" && hasExclusiveChoiceConflict(choices)) {
    return toClarificationPatch({
      activeChoices,
      choices,
      message,
      question: "「なし」とほかの選択肢が一緒に選ばれています。どちらで整理しますか？",
      reason: "exclusive-choice-conflict",
    })
  }

  if (choices.some((choice) => choice.id === "other") && !otherCommentPatch.otherChoiceComments?.[activeChoices.id]) {
    return toClarificationPatch({
      activeChoices,
      choices,
      message,
      question: "「その他」の内容を1つだけ補足してください。",
      reason: "other-choice-needs-detail",
    })
  }

  return null
}

function buildUnmatchedChoiceClarification(
  activeChoices: SurveyChoiceSet | undefined,
  message: string,
): ChoicePanelPatch | null {
  if (!activeChoices) return null
  if (activeChoices.id === "project-length" && isBareQuantity(message)) {
    return toClarificationPatch({
      activeChoices,
      choices: [],
      message,
      question: "その数値の単位を1つだけ教えてください。分、時間、本数など、どれに近いですか？",
      reason: "quantity-needs-unit",
    })
  }

  return null
}

function applyPendingClarificationAnswer(
  activeChoices: SurveyChoiceSet | undefined,
  clarification: ConversationState["activeIntakeClarification"] | undefined,
  message: string,
): ChoicePanelPatch | null {
  if (!activeChoices || clarification?.status !== "needs-clarification") return null
  if (clarification.choiceSetId !== activeChoices.id) return null

  const choices = resolveChoices(activeChoices, message)
  if (choices.length > 0) {
    const otherCommentPatch = toOtherChoiceCommentPatch(activeChoices, choices, message)
    const nestedClarification = assessChoiceAnswerClarity(activeChoices, choices, message, otherCommentPatch)
    if (nestedClarification) return nestedClarification
    return applyActiveChoiceAnswer({ activeChoices, message })
  }

  if (isExplicitUnknown(message)) {
    return applyUnknownButAcceptable(activeChoices, clarification, message)
  }

  if (clarification.selectedChoiceIds?.includes("other")) {
    const selectedChoices = choicesFromIds(activeChoices, clarification.selectedChoiceIds)
    if (selectedChoices.length > 0) {
      return applyActiveChoiceAnswer({
        activeChoices,
        message: `選択: ${clarification.selectedChoiceIds.join(",")}\nその他コメント: ${message.trim()}`,
      })
    }
  }

  return null
}

function applyUnknownButAcceptable(
  activeChoices: SurveyChoiceSet,
  clarification: NonNullable<ConversationState["activeIntakeClarification"]>,
  message: string,
): ChoicePanelPatch {
  const selectedChoices = choicesFromIds(activeChoices, clarification.selectedChoiceIds ?? [])
  const choice = selectedChoices[0] ?? activeChoices.choices.find((item) => undecidedChoiceIds.has(item.id)) ?? activeChoices.choices[0]
  return {
    choiceSetId: activeChoices.id,
    choiceId: choice.id,
    choiceIds: selectedChoices.length > 0 ? selectedChoices.map((item) => item.id) : [choice.id],
    conversationState: {
      ...toSlotSatisfiedPatch(activeChoices.id),
      ...toIntakeClarityPatch(activeChoices, selectedChoices, "unknown-but-acceptable", "explicitly-undecided", message),
    },
    jobContext: {},
  }
}

function toClarificationPatch(input: {
  activeChoices: SurveyChoiceSet
  choices: SurveyChoice[]
  message: string
  question: string
  reason: string
}): ChoicePanelPatch {
  const choice = input.choices[0] ?? input.activeChoices.choices[0]
  return {
    choiceSetId: input.activeChoices.id,
    choiceId: choice.id,
    choiceIds: input.choices.map((item) => item.id),
    conversationState: {
      activeIntakeClarification: {
        status: "needs-clarification",
        choiceSetId: input.activeChoices.id,
        selectedChoiceIds: input.choices.map((item) => item.id),
        question: input.question,
        reason: input.reason,
        answerPreview: preview(input.message),
      },
      intakeClarifications: {
        [input.activeChoices.id]: {
          status: "needs-clarification",
          reason: input.reason,
          answerPreview: preview(input.message),
        },
      },
    },
    jobContext: {},
  }
}

function toIntakeClarityPatch(
  activeChoices: SurveyChoiceSet,
  choices: SurveyChoice[],
  status: "clear" | "unknown-but-acceptable",
  reason: string,
  message?: string,
): Pick<ConversationState, "activeIntakeClarification" | "intakeClarifications"> {
  return {
    activeIntakeClarification: undefined,
    intakeClarifications: {
      [activeChoices.id]: {
        status,
        reason,
        answerPreview: preview(message ?? choices.map((choice) => choice.label).join(" / ")),
      },
    },
  }
}

function toUnknownChoicePatch(
  activeChoices: SurveyChoiceSet,
  choices: SurveyChoice[],
  message: string,
): Partial<ConversationState> {
  if (!choices.some((choice) => undecidedChoiceIds.has(choice.id)) && !isExplicitUnknown(message)) return {}
  return toIntakeClarityPatch(activeChoices, choices, "unknown-but-acceptable", "explicitly-undecided", message)
}

function toSlotSatisfiedPatch(choiceSetId: SurveyChoiceSet["id"]): Partial<ConversationState> {
  switch (choiceSetId) {
    case "job-kind":
      return { hasJobKind: true }
    case "project-length":
      return { hasProjectLength: true }
    case "final-medium":
      return { hasFinalMedium: true }
    case "additional-work":
      return { hasAdditionalWork: true }
    case "documentary-attachment":
      return { hasDocumentaryAttachments: true }
    case "work-site":
      return { hasWorkSite: true }
    case "lecture-training-content":
      return { hasLectureTrainingContent: true }
    case "lecture-training-format":
      return { hasLectureTrainingVenue: true }
    case "lecture-training-software":
      return { hasLectureTrainingSoftware: true }
    case "production-options":
      return { hasProductionOptions: true }
    default:
      return {}
  }
}

function hasExclusiveChoiceConflict(choices: SurveyChoice[]): boolean {
  return choices.some((choice) => noChoiceIds.has(choice.id)) && choices.some((choice) => !noChoiceIds.has(choice.id))
}

function choicesFromIds(choiceSet: SurveyChoiceSet, choiceIds: string[]): SurveyChoice[] {
  return choiceIds
    .map((choiceId) => choiceSet.choices.find((choice) => choice.id === choiceId))
    .filter((choice): choice is SurveyChoice => Boolean(choice))
}

function isBareQuantity(message: string): boolean {
  const compact = message.normalize("NFKC").trim()
  return /^\d+(?:\.\d+)?$/u.test(compact)
}

function isExplicitUnknown(message: string): boolean {
  const compact = message.normalize("NFKC").toLowerCase().replace(/[\s　。、,.!！?？「」『』()[\]（）]/g, "")
  return /^(未定|まだ未定|決まっていない|まだ決まっていない|わからない|分からない|不明)$/u.test(compact)
}

function preview(message: string): string {
  return message.trim().slice(0, 120)
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
