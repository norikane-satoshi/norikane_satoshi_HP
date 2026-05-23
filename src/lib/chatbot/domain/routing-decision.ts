import type { SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import type { CandidateWindow, ConversationSummary, JobContext } from "@/lib/chatbot/domain/workflow-estimate"

export type RoutingDecision =
  | { kind: "continue"; nextQuestion: string; presentChoices?: SurveyChoiceSet }
  | { kind: "to-booking-inline"; suggestedSlots: CandidateWindow[]; jobContext: JobContext }
  | { kind: "to-email"; summary: ConversationSummary }
  | {
      kind: "to-direct-contact"
      reason:
        | "out-of-scope"
        | "tech-question"
        | "review-request"
        | "vfx-cg-heavy"
        | "tight-deadline"
        | "raw-edit-included"
        | "heavy-retouch"
        | "plugin-detail"
        | "complex"
      requireEmail: true
      suggestedMessage: string
    }
