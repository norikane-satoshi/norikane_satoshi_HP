export type InvalidChoiceSetRegressionCase = {
  id: string
  requestId: string
  rawText: string
  customerText: string
  expectedBoundaryReason:
    | "choice-set-id-not-allowlisted"
    | "choice-set-question-too-long"
    | "choice-set-choice-count-out-of-range"
}

const validChoices = [
  { id: "feature-film", label: "商業映画" },
  { id: "other", label: "その他" },
]

function choicePanelRawText(input: {
  customerText: string
  id: string
  question: string
  choices: Array<{ id: string; label: string }>
}): string {
  return `<customer_reply>${input.customerText}\n${JSON.stringify({
    tool: "show_choice_panel",
    args: {
      id: input.id,
      question: input.question,
      selectionMode: "single",
      allowFreeText: true,
      choices: input.choices,
    },
  })}</customer_reply>`
}

// Pure data with no test-runner dependency so unit, API, and E2E suites can share it.
export const tierFallbackOutputContractIncident = {
  id: "incident-2026-08-02-tier2-body-only",
  requestId: "84c20d6d-261c-4020-8585-731ba880edda",
  userMessage:
    "商業映画のカラーグレーディングを相談したいです。尺は60分です。費用感を教えてください。",
  observed: {
    tier: "tier-2-gemini-flash",
    ui: "none",
    flowStep: "conversation",
    bookingProgress: false,
  },
  tier2RawText:
    "<customer_reply>のりかね映像設計室の事務担当です。商業映画のカラーグレーディングですね。費用は条件で変わるため、詳細をお聞かせい</customer_reply>",
  expected: {
    tier: "tier-2-gemini-flash",
    boundaryReason: "missing-structured-ui",
  },
} as const

const tooManyChoices = Array.from({ length: 11 }, (_, index) => ({
  label: `候補${index + 1}`,
  id: `candidate-${index + 1}`,
}))

export const invalidChoiceSetRegressionCorpus = [
  {
    id: "choice-set-id-not-allowlisted",
    requestId: "regression-choice-id-not-allowlisted",
    customerText: "まず案件の条件を伺います。",
    rawText: choicePanelRawText({
      customerText: "まず案件の条件を伺います。",
      id: "unregistered-intake-step",
      question: "案件の種類を教えてください",
      choices: validChoices,
    }),
    expectedBoundaryReason: "choice-set-id-not-allowlisted",
  },
  {
    id: "choice-set-question-over-140-characters",
    requestId: "regression-choice-question-over-140",
    customerText: "まず案件の条件を伺います。",
    rawText: choicePanelRawText({
      customerText: "まず案件の条件を伺います。",
      id: "job-kind",
      question: "あ".repeat(141),
      choices: validChoices,
    }),
    expectedBoundaryReason: "choice-set-question-too-long",
  },
  {
    id: "choice-set-fewer-than-2-options",
    requestId: "regression-choice-count-under-minimum",
    customerText: "まず案件の条件を伺います。",
    rawText: choicePanelRawText({
      customerText: "まず案件の条件を伺います。",
      id: "job-kind",
      question: "案件の種類を教えてください",
      choices: validChoices.slice(0, 1),
    }),
    expectedBoundaryReason: "choice-set-choice-count-out-of-range",
  },
  {
    id: "choice-set-more-than-10-options",
    requestId: "regression-choice-count-over-maximum",
    customerText: "まず案件の条件を伺います。",
    rawText: choicePanelRawText({
      customerText: "まず案件の条件を伺います。",
      id: "job-kind",
      question: "案件の種類を教えてください",
      choices: tooManyChoices,
    }),
    expectedBoundaryReason: "choice-set-choice-count-out-of-range",
  },
] as const satisfies readonly InvalidChoiceSetRegressionCase[]
