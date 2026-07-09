export type ChatbotLeakCorpusCase = {
  id: string
  family:
    | "thinking-signature-blob"
    | "internal-model-name"
    | "internal-lang-markup"
    | "english-user-monologue"
    | "japanese-volitional-monologue"
    | "missing-display-boundary"
    | "mixed-tool-json"
    | "internal-booking-ui-state"
    | "safe-polite-reply"
    | "safe-code-fence"
    | "safe-choice-panel"
    | "safe-booking-card"
  rawText: string
  expected: {
    outcome: "adopted" | "fallback"
    text: string
    fallbackApplied: boolean
    unsafe: boolean
  }
  api: {
    assertExactText?: boolean
    expectedUiKind?: "none" | "choice-panel" | "booking-card"
  }
}

export const chatbotLeakCorpusFallbackText = "作品名を教えていただけますか？"

const choicePanelTool =
  '{"tool":"show_choice_panel","args":{"id":"final-medium","question":"想定している公開先を教えてください","selectionMode":"single","allowFreeText":true,"choices":[{"id":"web-public","label":"Web公開"},{"id":"tv-broadcast","label":"地上波・BS／CS放送"}]}}'

const bookingCardTool =
  '{"tool":"show_booking_card","args":{"projectTitle":"CM案件","contactName":"山田太郎","companyName":"Example","contactEmail":"client@example.com","dueDate":"2026-07-31"}}'

export const chatbotLeakCorpus = [
  {
    id: "reject-thinking-signature-base64-blob",
    family: "thinking-signature-blob",
    rawText: `<customer_reply>I need to ask for a project name. claude-sonnet-4-5-thinking-signature-${"a".repeat(120)} 承知しました。案件名を教えてください。</customer_reply>`,
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: true,
    },
    api: {},
  },
  {
    id: "reject-internal-model-name",
    family: "internal-model-name",
    rawText: "<customer_reply>まず尺を教えてください。\nalmond-croissant-low</customer_reply>",
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: true,
    },
    api: {},
  },
  {
    id: "reject-internal-lang-markup",
    family: "internal-lang-markup",
    rawText:
      '<customer_reply>Web CM案件。次は尺を確認。<lang primary="Web CMのご相談、承りました。\nまず尺を教えてください。</lang></customer_reply>',
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: true,
    },
    api: {},
  },
  {
    id: "reject-english-user-said-monologue",
    family: "english-user-monologue",
    rawText:
      '<customer_reply>user said "特にないですー" (no particular preferences) regarding delivery format/distribution. I need to check what is still missing before show_booking_card.\n承りました。作品名を教えていただけますか？</customer_reply>',
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: true,
    },
    api: {},
  },
  {
    id: "reject-japanese-volitional-monologue-no-period",
    family: "japanese-volitional-monologue",
    rawText: "<customer_reply>最も重要なのでまずこれらを聞こう\n承りました。作品名を教えていただけますか？</customer_reply>",
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: true,
    },
    api: {},
  },
  {
    id: "reject-missing-display-boundary-raw-text",
    family: "missing-display-boundary",
    rawText: "承りました。まず作品名を教えていただけますか？",
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: false,
    },
    api: {},
  },
  {
    id: "reject-unbounded-mixed-tool-json",
    family: "mixed-tool-json",
    rawText: `候補を確認します。\n${bookingCardTool}`,
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: false,
    },
    api: {},
  },
  {
    id: "reject-internal-booking-ui-state",
    family: "internal-booking-ui-state",
    rawText:
      "<customer_reply>内容は受付済みなので同じ予約カードを再表示しません。則兼が内容を確認してご連絡します。</customer_reply>",
    expected: {
      outcome: "fallback",
      text: chatbotLeakCorpusFallbackText,
      fallbackApplied: true,
      unsafe: true,
    },
    api: {},
  },
  {
    id: "adopt-safe-polite-reply",
    family: "safe-polite-reply",
    rawText: "<customer_reply>ありがとうございます。まず作品名を教えていただけますか？</customer_reply>",
    expected: {
      outcome: "adopted",
      text: "ありがとうございます。まず作品名を教えていただけますか？",
      fallbackApplied: false,
      unsafe: false,
    },
    api: { assertExactText: true, expectedUiKind: "none" },
  },
  {
    id: "adopt-safe-code-fence",
    family: "safe-code-fence",
    rawText: "<customer_reply>例として、以下の形で送れます。\n```text\n作品名: 未定\n```</customer_reply>",
    expected: {
      outcome: "adopted",
      text: "例として、以下の形で送れます。\n```text\n作品名: 未定\n```",
      fallbackApplied: false,
      unsafe: false,
    },
    api: { assertExactText: true, expectedUiKind: "none" },
  },
  {
    id: "adopt-safe-choice-panel-payload",
    family: "safe-choice-panel",
    rawText: `<customer_reply>公開先を確認します。\n${choicePanelTool}</customer_reply>`,
    expected: {
      outcome: "adopted",
      text: `公開先を確認します。\n${choicePanelTool}`,
      fallbackApplied: false,
      unsafe: false,
    },
    api: {},
  },
  {
    id: "adopt-safe-booking-card-payload",
    family: "safe-booking-card",
    rawText: `<customer_reply>候補を確認します。\n${bookingCardTool}</customer_reply>`,
    expected: {
      outcome: "adopted",
      text: `候補を確認します。\n${bookingCardTool}`,
      fallbackApplied: false,
      unsafe: false,
    },
    api: {},
  },
] satisfies ChatbotLeakCorpusCase[]

export const chatbotLeakCorpusFamilyCounts = chatbotLeakCorpus.reduce<Record<string, number>>((counts, item) => {
  counts[item.family] = (counts[item.family] ?? 0) + 1
  return counts
}, {})
