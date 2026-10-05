import { projectConditionDefinitions, type ProjectConditionDefinition } from "@/lib/booking/domain/project-conditions"
import { describe, expect, it } from "vitest"
import { conditionChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import { applyActiveChoiceAnswer } from "../choice-panel-state"
import { missingConditionPanels, retainConditionAnswers, visibleConditionAnswers } from "../condition-intake"

describe("stable condition intake", () => {
  it("uses only structured customer answers even when legacy flags or inferred facts are present", () => {
    const panels = missingConditionPanels({ conditionAnswers: {}, hasJobKind: true, hasProjectLength: true, hasFinalMedium: true, hasDcpRequirement: true, dcpRequirement: "required" }, { jobKind: "cm", finalMedium: "cinema", projectLengthMinutes: 90 })
    expect(panels[0]?.id).toBe("job-kind")
    expect(panels.some(({ id }) => id === "project-length")).toBe(true)
    expect(panels.some(({ id }) => id === "final-medium")).toBe(true)
    expect(panels.some(({ id }) => id.startsWith("dcp-"))).toBe(false)
  })

  it.each([
    ["text", { text: "Customer note" }], ["number", { number: 4 }],
    ["date", { date: "2026-10-15" }], ["dates", { dates: ["2026-10-15", "2026-10-16"] as string[] }],
  ] as const)("generates and saves a new %s question from its definition alone", (input, answer) => {
    const definitions = projectConditionDefinitions as unknown as (ProjectConditionDefinition & { chatIntake?: boolean; order?: number })[]
    definitions.push({ id: "new-question", question: "New question copy", label: "New", input, options: [], chatIntake: true, order: -1 })
    try {
      expect(missingConditionPanels({})[0]?.id).toBe("new-question")
      const patch = applyActiveChoiceAnswer({ activeChoices: conditionChoiceSet("new-question"), message: "unrelated display copy", sourceMessageId: "new-message", conditionAnswer: { conditionId: "new-question", answer } })
      expect(patch?.conversationState.conditionAnswers?.["new-question"]).toEqual({ ...answer, status: "answered", sourceMessageId: "new-message" })
      expect(patch?.jobContext).toEqual({})
      expect(missingConditionPanels(patch?.conversationState ?? {}).some(({ id }) => id === "new-question")).toBe(false)
    } finally { definitions.pop() }
  })

  it("uses the structured composition and actual message provenance regardless of display copy", () => {
    const composition = [{ name: "Main", count: 2, durationSeconds: 30 }, { name: "Short", count: 3, durationSeconds: 15 }]
    const patch = applyActiveChoiceAnswer({ activeChoices: conditionChoiceSet("project-length"), message: "表示文は回答データではない", sourceMessageId: "actual-user-id", conditionAnswer: { conditionId: "project-length", answer: { status: "answered", composition, sourceMessageId: "client-forged-id" } } })
    expect(patch?.jobContext.projectLengthMinutes).toBe(1.75)
    expect(patch?.conversationState.conditionAnswers?.["project-length"]).toEqual({ status: "answered", composition, sourceMessageId: "actual-user-id" })
  })

  it("keeps unknown duration rows and clears the numeric estimate", () => {
    const composition = [{ count: 3, durationSeconds: 30 }, { count: 1 }]
    const patch = applyActiveChoiceAnswer({ activeChoices: conditionChoiceSet("project-length"), message: "構成", conditionAnswer: { conditionId: "project-length", answer: { status: "answered", composition } } })
    expect(patch?.conversationState.conditionAnswers?.["project-length"]?.composition).toEqual(composition)
    expect(patch?.jobContext).toHaveProperty("projectLengthMinutes", undefined)
  })

  it("rejects a submission for a different active question", () => {
    expect(applyActiveChoiceAnswer({ activeChoices: conditionChoiceSet("project-length"), message: "30秒", conditionAnswer: { conditionId: "retouch-cut-count", answer: { number: 30 } } })).toBeNull()
  })

  it.each(["short-film", "documentary", "cm", "mv", "feature", "drama", "vertical", "live"])("records %s without deriving duration", (id) => {
    const patch = applyActiveChoiceAnswer({ activeChoices: conditionChoiceSet("job-kind"), message: "表示文", conditionAnswer: { conditionId: "job-kind", answer: { selectedIds: [id] } } })
    expect(patch?.jobContext).toEqual({ jobKind: id })
    expect(patch?.conversationState.conditionAnswers?.["job-kind"]?.selectedIds).toEqual([id])
  })

  it("keeps DCP creator visible for a cinema project whose DCP need is unknown", () => {
    const panels = missingConditionPanels({ conditionAnswers: { "final-medium": { status: "answered", selectedIds: ["cinema", "web"] }, "dcp-required": { status: "unknown" } } })
    expect(panels.some(({ id }) => id === "dcp-creator")).toBe(true)
    expect(missingConditionPanels({ conditionAnswers: { "final-medium": { status: "answered", selectedIds: ["web"] } } }).some(({ id }) => id.startsWith("dcp-"))).toBe(false)
  })

  it("asks the optional retouch count only when selected work requires it", () => {
    expect(missingConditionPanels({ conditionAnswers: { "additional-work": { status: "answered", selectedIds: ["retouch"] } } }).some(({ id }) => id === "retouch-cut-count")).toBe(true)
    const patch = applyActiveChoiceAnswer({ activeChoices: conditionChoiceSet("retouch-cut-count"), message: "未定", sourceMessageId: "count", conditionAnswer: { conditionId: "retouch-cut-count", answer: { status: "unknown" } } })
    expect(patch?.conversationState.conditionAnswers?.["retouch-cut-count"]).toEqual({ status: "unknown", sourceMessageId: "count" })
    expect(patch?.jobContext.retouchCutCount).toBeUndefined()
  })

  it("drops hidden answers and answers whose source was truncated by an edit", () => {
    const answers = { "final-medium": { status: "answered" as const, selectedIds: ["web"], sourceMessageId: "kept" }, "dcp-required": { status: "answered" as const, selectedIds: ["required"], sourceMessageId: "kept" }, "project-length": { status: "answered" as const, composition: [{ count: 1, durationSeconds: 60 }], sourceMessageId: "future" } }
    expect(Object.keys(visibleConditionAnswers(answers))).toEqual(["final-medium", "project-length"])
    expect(Object.keys(retainConditionAnswers(answers, new Set(["kept"])))).toEqual(["final-medium", "dcp-required"])
  })
})
