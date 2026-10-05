import { parseProjectLengthMinutes } from "@/lib/chatbot/domain/project-length"
import { isSelectableDeadline } from "@/lib/chatbot/domain/deadline"
import { getProjectConditionDefinition, validateConditionAnswers, type ConditionAnswer } from "@/lib/booking/domain/project-conditions"
import { totalWorkCompositionMinutes, validWorkComposition, type WorkCompositionRow } from "@/lib/booking/domain/work-composition"
import { isConditionAnswered } from "./condition-intake"
import { normalizeJobKind } from "@/lib/booking/domain/job-kind"
import type {
  ConversationState,
  DocumentaryAttachment,
  DocumentaryAttachmentItem,
  FinalMedium,
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

export type ConditionSubmission = { conditionId: string; answer: ConditionAnswer }

export function applyActiveChoiceAnswer(input: {
  activeChoices?: SurveyChoiceSet
  message: string
  activeIntakeClarification?: ConversationState["activeIntakeClarification"]
  sourceMessageId?: string
  conditionAnswer?: ConditionSubmission
}): ChoicePanelPatch | null {
  const id = input.activeChoices?.id
  const definition = id ? getProjectConditionDefinition(id) : undefined
  if (input.conditionAnswer) {
    if (!definition || input.conditionAnswer.conditionId !== id) return null
    const submitted = input.conditionAnswer.answer
    const unknown = submitted.status === "unknown" || submitted.selectedIds?.includes("undecided") === true
    const selectedIds = submitted.selectedIds ? [...new Set(submitted.selectedIds.map((value) => id === "job-kind" ? normalizeJobKind(value) ?? value : value))] : undefined
    if (!validateConditionAnswers({ [definition.id]: { ...submitted, ...(selectedIds ? { selectedIds } : {}) } }).success) return null
    if (selectedIds?.some((value) => !definition.options.some((option) => option.id === value))) return null
    if (definition.input === "single" && selectedIds && selectedIds.length > 1) return null
    if (!unknown && definition.input === "composition" && (!submitted.composition || !validWorkComposition(submitted.composition))) return null
    if (!unknown && definition.input === "number" && (submitted.number === undefined || !Number.isSafeInteger(submitted.number) || submitted.number < 0)) return null
    if (!unknown && definition.input === "date" && !submitted.date) return null
    if (!unknown && definition.input === "text" && !submitted.text?.trim()) return null
    if (!unknown && (definition.input === "single" || definition.input === "multiple") && !selectedIds?.length) return null
    if (!unknown && definition.input === "dates" && (!submitted.dates?.length && !submitted.text?.trim())) return null
    const choices = (selectedIds ?? []).map((value) => definition.options.find((choice) => choice.id === value)!).filter(Boolean)
    if (hasExclusiveChoiceConflict(choices)) return null
    const otherComment = submitted.otherComment?.trim()
    if (!unknown && selectedIds?.includes("other") && !otherComment && !submitted.text?.trim()) return null
    const selectedPatch = choices.length ? applyChoiceSelection(input.activeChoices!, choices,
      otherComment ? { otherChoiceComments: { [definition.id]: otherComment } } : {}, input.message) : null
    const patch: ChoicePanelPatch = selectedPatch ?? {
      choiceSetId: definition.id, choiceId: unknown ? "undecided" : "explicit-answer", choiceIds: selectedIds ?? [],
      conversationState: { ...toSlotSatisfiedPatch(definition.id), activeIntakeClarification: undefined }, jobContext: {},
    }
    Object.assign(patch.conversationState, toStructuredValueState(definition.id, submitted, unknown))
    if (definition.id === "project-length") patch.jobContext.projectLengthMinutes = unknown ? undefined : totalWorkCompositionMinutes(submitted.composition!)
    if (definition.id === "retouch-cut-count") patch.jobContext.retouchCutCount = unknown ? undefined : submitted.number
    const answer: ConditionAnswer = unknown ? { status: "unknown" } : {
      status: "answered", ...(selectedIds ? { selectedIds } : {}),
      ...(submitted.text ? { text: submitted.text.trim() } : {}),
      ...(submitted.date ? { date: submitted.date } : {}),
      ...(submitted.dates ? { dates: submitted.dates } : {}),
      ...(submitted.composition ? { composition: submitted.composition } : {}),
      ...(submitted.number !== undefined ? { number: submitted.number } : {}),
      ...(submitted.otherComment ? { otherComment: submitted.otherComment.trim() } : {}),
    }
    if (definition.id !== "booking-final-confirmation") patch.conversationState.conditionAnswers = { [definition.id]: { ...answer, ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}) } }
    return patch
  }
  let patch: ChoicePanelPatch | null
  let answer: ConditionAnswer | undefined
  if (id === "project-length") {
    const value = input.message.normalize("NFKC").replace(/^\s*(?:作品構成|尺)\s*[:：]\s*/u, "").trim()
    if (isExplicitUnknown(value)) {
      answer = { status: "unknown", selectedIds: ["undecided"] }
      patch = { choiceSetId: id, choiceId: "undecided", choiceIds: ["undecided"], conversationState: { hasProjectLength: true, activeIntakeClarification: undefined }, jobContext: { projectLengthMinutes: undefined } }
    } else {
      let rows: WorkCompositionRow[] | undefined
      try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed) && validWorkComposition(parsed)) rows = parsed } catch { /* Explicit legacy duration is accepted below. */ }
      const minutes = rows ? totalWorkCompositionMinutes(rows) : parseProjectLengthMinutes(value)
      if (!rows && minutes === undefined) return null
      rows ??= [{ count: 1, durationSeconds: Math.round(minutes! * 60) }]
      if (!validWorkComposition(rows)) return null
      answer = { status: "answered", composition: rows }
      patch = { choiceSetId: id, choiceId: "exact-duration", choiceIds: [], conversationState: { hasProjectLength: true, activeIntakeClarification: undefined }, jobContext: { projectLengthMinutes: totalWorkCompositionMinutes(rows) } }
    }
  } else if (id === "retouch-cut-count") {
    const value = input.message.normalize("NFKC").replace(/^\s*(?:修正カット数|選択)\s*[:：]\s*/u, "").trim()
    const unknown = isExplicitUnknown(value)
    const count = /^\d+(?:\s*カット)?$/u.test(value) ? Number(value.replace(/\s*カット$/u, "")) : undefined
    if (!unknown && (count === undefined || !Number.isSafeInteger(count) || count < 0)) return null
    answer = unknown ? { status: "unknown", selectedIds: ["undecided"] } : { status: "answered", number: count }
    patch = { choiceSetId: id, choiceId: unknown ? "undecided" : "explicit-number", choiceIds: unknown ? ["undecided"] : [], conversationState: { activeIntakeClarification: undefined }, jobContext: { retouchCutCount: unknown ? undefined : count } }
  } else {
    patch = applyLegacyChoiceAnswer(input)
    if (patch && definition && patch.conversationState.activeIntakeClarification?.status !== "needs-clarification") {
      const text = input.message.normalize("NFKC").replace(/^\s*[^:\n]+\s*[:：]\s*/u, "").trim()
      answer = {
        status: patch.choiceIds.includes("undecided") ? "unknown" : "answered",
        ...((definition.input === "single" || definition.input === "multiple") && patch.choiceIds.length ? { selectedIds: patch.choiceIds } : {}),
        ...(definition.input === "text" && !patch.choiceIds.includes("undecided") ? { text } : {}),
        ...(definition.input === "date" && !patch.choiceIds.includes("undecided") ? { date: text } : {}),
        ...(patch.conversationState.otherChoiceComments?.[patch.choiceSetId] ? { otherComment: patch.conversationState.otherChoiceComments[patch.choiceSetId] } : {}),
      }
      if (id === "job-kind" && answer.selectedIds) answer.selectedIds = answer.selectedIds.map((value) => normalizeJobKind(value) ?? value)
    }
  }
  if (!patch || !answer) return patch
  if (patch.choiceSetId !== "booking-final-confirmation") patch.conversationState.conditionAnswers = { [patch.choiceSetId]: { ...answer, ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}) } }
  return patch
}

function toStructuredValueState(id: string, answer: ConditionAnswer, unknown: boolean): Partial<ConversationState> {
  const value = unknown ? "未確認" : answer.text?.trim() ?? answer.date
  switch (id) {
    case "delivery-format": return { hasDeliveryFormat: true, deliveryFormat: value }
    case "dcp-creator": return { hasDcpCreator: true, dcpCreator: value }
    case "material-timing": return { hasMaterialTiming: true, materialHandoff: { timing: value } }
    case "dcp-required": return unknown ? { hasDcpRequirement: true, dcpRequirement: "undecided" } : {}
    default: return {}
  }
}

function applyLegacyChoiceAnswer(input: {
  activeChoices?: SurveyChoiceSet
  message: string
  activeIntakeClarification?: ConversationState["activeIntakeClarification"]
}): ChoicePanelPatch | null {
  if (input.activeChoices?.id === "reference-urls" && /^https?:\/\/\S+$/u.test(input.message.trim())) {
    const choice = input.activeChoices.choices.find((item) => item.id === "other")
    if (choice) return applyChoiceSelection(input.activeChoices, [choice], { otherChoiceComments: { "reference-urls": input.message.trim() } }, input.message)
  }
  const textIntake = [
    { id: "delivery-format", label: "納品形式", flag: "hasDeliveryFormat", field: "deliveryFormat" },
    { id: "dcp-creator", label: "DCP作成担当", flag: "hasDcpCreator", field: "dcpCreator" },
    { id: "material-timing", label: "素材が揃う日", flag: "hasMaterialTiming", field: "materialTiming" },
  ] as const
  const intake = textIntake.find((item) => input.activeChoices?.id === item.id)
  if (intake) {
    const value = input.message.normalize("NFKC").replace(new RegExp(`^(?:${intake.label}|選択)\\s*[:：]\\s*`, "u"), "").trim()
    if (!value || /[?？]/u.test(value)) return null
    const unknown = isExplicitUnknown(value)
    if (intake.id === "material-timing" && !unknown && !isSelectableDeadline(value)) return null
    return {
      choiceSetId: intake.id, choiceId: unknown ? "undecided" : "explicit-text", choiceIds: [unknown ? "undecided" : "explicit-text"],
      conversationState: {
        [intake.flag]: true,
        ...(intake.id === "material-timing" ? { materialHandoff: { timing: unknown ? "未確認" : value } } : { [intake.field]: unknown ? "未確認" : value }),
        activeIntakeClarification: undefined,
        intakeClarifications: { [intake.id]: { status: unknown ? "unknown-but-acceptable" : "clear", reason: "explicit-answer", answerPreview: preview(value) } },
      },
      jobContext: {},
    }
  }
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

  return applyChoiceSelection(activeChoices, choices, otherCommentPatch, input.message)
}

function applyChoiceSelection(
  activeChoices: SurveyChoiceSet,
  choices: SurveyChoice[],
  otherCommentPatch: Partial<ConversationState>,
  message: string,
): ChoicePanelPatch | null {
  const choice = choices[0]
  if (!choice) return null
  switch (activeChoices.id) {
    case "dcp-required":
      return {
        choiceSetId: activeChoices.id, choiceId: choice.id, choiceIds: [choice.id],
        conversationState: {
          hasDcpRequirement: true,
          dcpRequirement: choice.id as "required" | "not-required" | "undecided",
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
        jobContext: {},
      }
    case "job-kind": {
      const jobKindPatch = applyJobKindChoice(activeChoices, choice, otherCommentPatch)
      return {
        ...jobKindPatch,
        conversationState: {
          ...jobKindPatch.conversationState,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
      }
    }
    case "final-medium":
      const finalMediumPatch = toFinalMediumJobContextPatch(activeChoices, choices)
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: choices.map((item) => item.id),
        conversationState: {
          hasFinalMedium: true,
          ...finalMediumPatch.conversationState,
          ...otherCommentPatch,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
        jobContext: finalMediumPatch.jobContext,
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
          workSiteLabel: choice.label,
          ...otherCommentPatch,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          ...toUnknownChoicePatch(activeChoices, choices, message),
        },
        jobContext: { workSite: toWorkSite(choice.id) },
      }
    case "lecture-training-content":
      const normalizedLectureTrainingChoices = normalizeLectureTrainingContentChoices(choices)
      return {
        choiceSetId: activeChoices.id,
        choiceId: normalizedLectureTrainingChoices[0]?.id ?? choice.id,
        choiceIds: normalizedLectureTrainingChoices.map((item) => item.id),
        conversationState: {
          requestKind: "lecture-training",
          hasLectureTrainingIntent: true,
          hasLectureTrainingContent: true,
          requiresNorikaneConfirmation: true,
          lectureTrainingInquiry: {
            content: normalizedLectureTrainingChoices
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
          ...toUnknownChoicePatch(activeChoices, choices, message),
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
    case "booking-final-confirmation":
      if (choice.id === "none") {
        return {
          choiceSetId: activeChoices.id,
          choiceId: choice.id,
          choiceIds: [choice.id],
          conversationState: {
            bookingFinalConfirmation: {
              status: "confirmed",
            },
            bookingReadiness: {
              finalQuestionOffered: true,
              additionalConcernStatus: "none",
              additionalConcernSource: "choice-panel",
            },
            ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          },
          jobContext: {},
        }
      }

      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: {
          bookingFinalConfirmation: {
            status: "supplemental-received",
            supplementalNote: otherCommentPatch.otherChoiceComments?.[activeChoices.id] ?? labelChoice(activeChoices, choice.id),
          },
          bookingReadiness: {
            finalQuestionOffered: true,
            additionalConcernStatus: "has-concern",
            additionalConcernSource: "choice-panel",
          },
          ...otherCommentPatch,
          ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
        },
        jobContext: {},
      }
    case "reference-urls":
      if (choices.some((item) => item.id === "none")) {
        return {
          choiceSetId: activeChoices.id,
          choiceId: "none",
          choiceIds: ["none"],
          conversationState: {
            hasReferenceUrls: true,
            ...toIntakeClarityPatch(activeChoices, choices, "clear", "choice-confirmed"),
          },
          jobContext: {},
        }
      }
      if (!otherCommentPatch.otherChoiceComments?.[activeChoices.id]) return null
      return {
        choiceSetId: activeChoices.id,
        choiceId: choice.id,
        choiceIds: [choice.id],
        conversationState: {
          hasReferenceUrls: true,
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
  const unmatchedChoiceText = extractUnmatchedChoiceText(message)
  if (activeChoices.id === "project-length" && isBareQuantity(message)) {
    return toClarificationPatch({
      activeChoices,
      choices: [],
      message,
      question: "その数値の単位を1つだけ教えてください。分、時間、本数など、どれに近いですか？",
      reason: "quantity-needs-unit",
    })
  }
  if (unmatchedChoiceText && activeChoices.choices.some((choice) => choice.id === "other")) {
    return applyActiveChoiceAnswer({
      activeChoices,
      message: `選択: other\nその他コメント: ${unmatchedChoiceText}`,
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
    case "booking-final-confirmation":
      return {}
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

const canonicalFinalMediumIds = new Set<FinalMedium>([
  "ott",
  "cinema",
  "tv-broadcast",
  "blu-ray",
  "youtube",
  "web",
  "vertical-sns",
  "other",
])

function toFinalMediumJobContextPatch(
  activeChoices: SurveyChoiceSet,
  choices: SurveyChoice[],
): {
  conversationState: Partial<ConversationState>
  jobContext: Pick<JobContext, "finalMedium">
} {
  const finalMedia = choices.map(normalizeFinalMediumChoice)
  const primaryFinalMedium = finalMedia.find((medium) => medium !== "other") ?? "other"
  const otherChoice = choices.find((choice) => normalizeFinalMediumChoice(choice) === "other")

  return {
    conversationState: {
      finalMedia,
      ...(otherChoice
        ? {
            otherChoiceComments: {
              [activeChoices.id]: otherChoice.label,
            },
          }
        : {}),
    },
    jobContext: { finalMedium: primaryFinalMedium },
  }
}

function normalizeFinalMediumChoice(choice: SurveyChoice): FinalMedium {
  if (canonicalFinalMediumIds.has(choice.id as FinalMedium)) return choice.id as FinalMedium

  const normalized = `${choice.id} ${choice.label}`.normalize("NFKC").toLowerCase()
  if (/(?:ott|配信|streaming|vod|svod|tvod|hulu|netflix|prime|disney)/u.test(normalized)) return "ott"
  if (/(?:劇場|映画館|cinema|theater|上映|映画祭)/u.test(normalized)) return "cinema"
  if (/(?:テレビ|tv|放送|地上波|bs|cs|broadcast)/u.test(normalized)) return "tv-broadcast"
  if (/(?:blu-?ray|ブルーレイ|ディスク|package|パッケージ)/u.test(normalized)) return "blu-ray"
  if (/(?:youtube|ユーチューブ)/u.test(normalized)) return "youtube"
  if (/(?:縦型|縦動画|縦長|shorts|reels|tiktok|vertical)/u.test(normalized)) return "vertical-sns"
  if (/(?:web|ウェブ|youtube|vimeo|サイト|sns|公開)/u.test(normalized)) return "web"

  return "other"
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
  return Boolean(choiceSet && isConditionAnswered(choiceSet.id, conversationState))
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
      activeChoices.choices.find((choice) => choiceTextMatches(activeChoices, choice, normalizedMessage)) ??
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
  if (choice.id === "grading-consultation" || choice.id === "correction-consultation") {
    return {
      choiceSetId: choiceSet.id,
      choiceId: choice.id,
      choiceIds: [choice.id],
      conversationState: {
        hasJobKind: true,
        otherChoiceComments: { [choiceSet.id]: "カラーグレーディング相談" },
        ...otherCommentPatch,
      },
      jobContext: {},
    }
  }

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
  return normalizeJobKind(choiceId)
}

function normalizeLectureTrainingContentChoices(choices: SurveyChoice[]): SurveyChoice[] {
  const normalizedChoices = choices.map((choice) =>
    choice.id === "correction" ? { id: "grading", label: "カラーグレーディング" } : choice,
  )
  return normalizedChoices.filter(
    (choice, index, items) => items.findIndex((item) => item.id === choice.id) === index,
  )
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
  if (choiceId === "on-site") return "on-site"
  return "remote-grading"
}

function labelChoice(choiceSet: SurveyChoiceSet, choiceId: string): string {
  return choiceSet.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId
}

function normalizeChoiceText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ")
}

function choiceTextMatches(choiceSet: SurveyChoiceSet, choice: SurveyChoice, normalizedMessage: string): boolean {
  const messageKey = normalizeChoiceComparableText(normalizedMessage)
  if (!messageKey) return false
  return [choice.id, choice.label]
    .map(normalizeChoiceComparableText)
    .some((candidate) => candidate === messageKey || containsComparableChoiceText(choiceSet, candidate, messageKey))
}

function normalizeChoiceComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(choicePrefixPattern, "")
    .replace(/[。.!！?？]+$/gu, "")
    .replace(/(?:でお願いします|をお願いします|お願いします|にします|です)$/u, "")
    .replace(/[\s　/／|｜・:：-]+/gu, "")
}

function containsComparableChoiceText(choiceSet: SurveyChoiceSet, candidate: string, messageKey: string): boolean {
  if (choiceSet.id !== "job-kind" && choiceSet.id !== "project-length") return false
  if (messageKey.length < 2) return false
  return candidate.includes(messageKey) || messageKey.includes(candidate)
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

function extractUnmatchedChoiceText(message: string): string | undefined {
  const firstLine = message.split(/\r?\n/u)[0] ?? ""
  if (!choicePrefixPattern.test(firstLine)) return undefined
  const text = firstLine.replace(choicePrefixPattern, "").trim()
  return text.length > 0 && !isExplicitUnknown(text) ? text : undefined
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
