import type { RoutingDecision } from "@/lib/chatbot/domain"

export type SingleUserPromptGuardUiKind =
  | "none"
  | "choice-panel"
  | "booking-card"
  | "direct-contact-card"
  | "consultation-summary-form"
  | "tier3-inquiry-form"

export type SingleUserPromptGuardReason =
  | "choice-panel"
  | "booking-final-confirmation"
  | "booking-card"
  | "summary-form"
  | "tier3-inquiry-form"

export type SingleUserPromptGuardContent = {
  content: string
  reason: SingleUserPromptGuardReason
  choiceSetId?: string
}

/**
 * Picks the copy that goes with the UI the customer will actually see.
 *
 * The rendered UI decides first. Following the routing decision instead let a Tier 3 downgrade
 * keep the choice-panel wording, so the reply said "下の選択肢から選んでください" while the
 * inquiry form rendered and the customer had nothing to choose.
 */
export function buildSingleUserPromptGuardContent(input: {
  routingDecision: RoutingDecision | undefined
  uiKind: SingleUserPromptGuardUiKind
}): SingleUserPromptGuardContent | undefined {
  switch (input.uiKind) {
    case "booking-card":
      return {
        content: "候補日を確認しました。\n下の予約カードから選択してください。",
        reason: "booking-card",
      }
    case "consultation-summary-form":
      return {
        content: "下のフォームで相談内容を確認して送信してください。",
        reason: "summary-form",
      }
    case "tier3-inquiry-form":
      return {
        content: "下のフォームからお問い合わせください。",
        reason: "tier3-inquiry-form",
      }
    default:
      break
  }

  if (input.routingDecision?.kind === "continue" && input.routingDecision.presentChoices) {
    if (input.uiKind !== "choice-panel") return undefined
    return {
      content: `${input.routingDecision.nextQuestion}\n下の選択肢から選んでください。`,
      reason: "choice-panel",
      choiceSetId: input.routingDecision.presentChoices.id,
    }
  }

  if (
    input.routingDecision?.kind === "continue" &&
    input.routingDecision.nextQuestion.includes("ほかに確認したいこと")
  ) {
    return {
      content: input.routingDecision.nextQuestion,
      reason: "booking-final-confirmation",
    }
  }

  return undefined
}
