import { describe, expect, it } from "vitest"
import { getProjectConditionDefinition, isConditionVisible, projectConditionDefinitions, projectConditionDetails, formatConditionAnswer, validateConditionAnswers, sanitizeConditionAnswers } from "./project-conditions"

it("uses the same declarative deadline reason visibility in every output", () => {
  const definition = getProjectConditionDefinition("delivery-date-reason")!
  expect(isConditionVisible(definition, {})).toBe(false)
  expect(isConditionVisible(definition, { "desired-delivery-date": { status: "unknown" } })).toBe(false)
  expect(isConditionVisible(definition, { "desired-delivery-date": { date: "2026-10-25" } })).toBe(true)
  expect(isConditionVisible(definition, { "desired-delivery-date": { status: "unknown" }, "delivery-date-reason": { text: "試写会" } })).toBe(true)
})
import { confirmedBookingDetails, displayBookingDetails, bookingDetailsMemo, readBookingDetailsMemo } from "@/lib/chatbot/domain/booking-details"
import { conditionChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import { matchChoiceAnswer } from "@/lib/chatbot/domain/choice-answer"
import { normalizeJobKind, workflowPresetJobKind } from "./job-kind"

describe("stable project conditions", () => {
  it("has unique stable question and option IDs", () => {
    expect(new Set(projectConditionDefinitions.map(({ id }) => id)).size).toBe(projectConditionDefinitions.length)
    for (const definition of projectConditionDefinitions) expect(new Set(definition.options.map(({ id }) => id)).size).toBe(definition.options.length)
    expect(conditionChoiceSet("project-length")).toMatchObject({ id: "project-length", input: "composition" })
    expect(conditionChoiceSet("job-kind").choices.map(({ id }) => id)).toContain("short-film")
  })
  it("keeps answers stable when question and option labels change", () => {
    const definition = getProjectConditionDefinition("job-kind")!
    const edited = { ...definition, question: "別の質問文", options: definition.options.map((option) => option.id === "cm" ? { ...option, label: "コマーシャル" } : option) }
    expect(formatConditionAnswer(edited, { selectedIds: ["cm"] })).toBe("コマーシャル")
    expect(confirmedBookingDetails({ messages: [{ id: "a", role: "assistant", content: "別の質問文", createdAt: "2026-10-05" }, { id: "u", role: "user", content: "別の返答文", createdAt: "2026-10-05" }], conversationState: { conditionAnswers: { "job-kind": { selectedIds: ["cm"] } } } })).toContainEqual({ label: "案件種別", value: "Web CM / CM" })
  })
  it("never reads transcript answers once ID state exists, even when empty", () => {
    expect(confirmedBookingDetails({ messages: [{ id: "u", role: "user", content: "尺: 90分\n納品形式: ProRes", createdAt: "2026-10-05" }], conversationState: { conditionAnswers: {} } })).toContainEqual({ label: "尺", value: "未確認" })
    expect(confirmedBookingDetails({ messages: [{ id: "u", role: "user", content: "尺: 90分\n納品形式: ProRes", createdAt: "2026-10-05" }], conversationState: { conditionAnswers: { "job-kind": { selectedIds: ["cm"] } } } })).toContainEqual({ label: "納品形式", value: "未確認" })
  })
  it("validates input by question ID and removes hidden answers from public input", () => {
    expect(sanitizeConditionAnswers({ "job-kind": { selectedIds: ["cm"] }, "project-length": { composition: [{ name: " 本編 ", count: 2, durationSeconds: 15 }] }, "lecture-training-content": { selectedIds: ["grading"] }, "unavailable-dates": { text: "毎週水曜" } })).toEqual({ "job-kind": { selectedIds: ["cm"] }, "project-length": { composition: [{ name: "本編", count: 2, durationSeconds: 15 }] }, "unavailable-dates": { text: "毎週水曜" } })
    expect(sanitizeConditionAnswers({ "project-length": { status: "unknown", composition: [{ count: 1, durationSeconds: 15 }] } })).toEqual({ "project-length": { status: "unknown" } })
  })
  it.each([
    { invented: { text: "回答" } },
    { "job-kind": { selectedIds: ["cm-30s"] } },
    { "job-kind": { selectedIds: ["cm", "mv"] } },
    { "desired-delivery-date": { date: "2026-02-30" } },
    { "preferred-dates": { dates: ["not-a-date"] } },
    { "job-kind": { number: 2 } },
    { "project-length": { composition: [{ count: 0, durationSeconds: 15 }] } },
    { "project-length": { composition: [{ count: 1, durationSeconds: 0.5 }] } },
    { "project-length": { composition: [{ count: Number.MAX_SAFE_INTEGER, durationSeconds: 2 }] } },
  ])("rejects malformed public input %#", (answers) => {
    expect(validateConditionAnswers(answers).success).toBe(false)
    expect(() => sanitizeConditionAnswers(answers)).toThrow(TypeError)
  })
  it("uses the same definition value for an unanswered preferred date in every output", () => {
    const details = confirmedBookingDetails({ conversationState: { conditionAnswers: {} } })
    expect(projectConditionDetails({})).toContainEqual({ label: "希望日", value: "未定（日程は則兼と相談）" })
    expect(displayBookingDetails(details)).toContainEqual({ label: "希望日", value: "未定（日程は則兼と相談）" })
    expect(bookingDetailsMemo("", details)).toContain("希望日: 未定（日程は則兼と相談）")
  })
  it("reads definition fields from legacy memos and excludes internal estimates", () => {
    expect(readBookingDetailsMemo("案件種別: Web CM / CM\n作品構成: 本編 2本 × 15秒\n希望日: 2026/10/20(火)\n基本工程目安: 8時間\n参考: https://example.com\n補足文")).toEqual({ details: [{ label: "案件種別", value: "Web CM / CM" }, { label: "作品構成", value: "本編 2本 × 15秒" }, { label: "希望日", value: "2026-10-20" }], note: "参考: https://example.com\n補足文" })
    expect(bookingDetailsMemo("都合の悪い日: 旧日程", [{ label: "都合の悪い日", value: "毎週水曜" }])).toBe("都合の悪い日: 毎週水曜")
  })
  it("shows compositing counts and lecture details through their declared visibility", () => {
    const answers = { "job-kind": { selectedIds: ["lecture-training"] }, "lecture-training-content": { selectedIds: ["grading"] }, "lecture-training-format": { selectedIds: ["online"] }, "lecture-training-software": { selectedIds: ["davinci-resolve-studio"] }, "additional-work": { selectedIds: ["compositing"] }, "retouch-cut-count": { number: 5 } }
    const details = confirmedBookingDetails({ conversationState: { conditionAnswers: answers } })
    expect(displayBookingDetails(details)).toContainEqual({ label: "修正カット数", value: "5" })
    expect(displayBookingDetails(details)).toContainEqual({ label: "講習内容", value: "カラーグレーディング" })
    expect(bookingDetailsMemo("", details)).toContain("使用ソフト: DaVinci Resolve Studio")
    expect(displayBookingDetails(confirmedBookingDetails({ conversationState: { conditionAnswers: { "job-kind": { selectedIds: ["cm"] }, "lecture-training-software": { selectedIds: ["davinci-resolve-studio"] } } } })).some(({ label }) => label === "使用ソフト")).toBe(false)
  })
  it("preserves confirmed lecture choices in legacy logs without using intent flags as answers", () => {
    const message = { id: "u", role: "user" as const, content: "選択: カラーグレーディング", createdAt: "2026-10-05" }
    const choiceSet = conditionChoiceSet("lecture-training-content")
    const details = confirmedBookingDetails({ messages: [message], conversationState: { choiceAnswers: { u: matchChoiceAnswer(choiceSet, message.content)! } } })
    expect(displayBookingDetails(details)).toContainEqual({ label: "講習内容", value: "カラーグレーディング" })
    expect(confirmedBookingDetails({ conversationState: { requestKind: "lecture-training", hasLectureTrainingIntent: true } })).toContainEqual({ label: "案件種別", value: "未確認" })
  })
  it("prefers ID answers over obsolete transcript labels and estimate anchors", () => {
    const details = confirmedBookingDetails({ messages: [{ id: "u", role: "user", content: "尺: 90分\n案件種別: 長編", createdAt: "2026-10-05" }], conversationState: { conditionAnswers: { "job-kind": { selectedIds: ["cm"] }, "project-length": { composition: [{ name: "本編", count: 2, durationSeconds: 15 }, { name: "別版", count: 1, durationSeconds: 30 }] } } } })
    expect(details).toContainEqual({ label: "尺", value: "1分" })
    expect(details).toContainEqual({ label: "作品構成", value: "本編 2本 × 15秒 / 別版 1本 × 30秒" })
    expect(bookingDetailsMemo("", details)).toContain("作品構成: 本編 2本 × 15秒 / 別版 1本 × 30秒")
  })
  it("projects conditional answers consistently to review and memo", () => {
    const answers = { "final-medium": { selectedIds: ["cinema"] }, "dcp-required": { selectedIds: ["not-required"] }, "dcp-creator": { text: "旧担当" }, "additional-work": { selectedIds: ["retouch"] }, "retouch-cut-count": { number: 12 } }
    expect(isConditionVisible(getProjectConditionDefinition("retouch-cut-count")!, answers)).toBe(true)
    const details = confirmedBookingDetails({ conversationState: { conditionAnswers: answers } })
    expect(displayBookingDetails(details)).toContainEqual({ label: "修正カット数", value: "12" })
    expect(displayBookingDetails(details).some(({ label }) => label === "DCP作成担当")).toBe(false)
    expect(bookingDetailsMemo("", details)).not.toContain("旧担当")
  })
  it("does not turn incomplete composition into an estimate", () => {
    expect(projectConditionDetails({ "project-length": { composition: [{ count: 2, durationSeconds: 15 }, { count: 1 }] } })).toContainEqual({ label: "尺", value: "未確認" })
    expect(projectConditionDetails({ "project-length": { status: "unknown", composition: [{ count: 1, durationSeconds: 15 }] } })).toContainEqual({ label: "尺", value: "未確認" })
  })
  it("keeps dates and reasons in the definition-driven output", () => {
    const details = confirmedBookingDetails({ conversationState: { conditionAnswers: { "desired-delivery-date": { date: "2026-10-25" }, "delivery-date-reason": { text: "試写会" }, "preferred-dates": { dates: ["2026-10-20", "2026-10-21"] }, "unavailable-dates": { dates: ["2026-10-22"] } } } })
    expect(details).toContainEqual({ label: "納品希望日の理由", value: "試写会" })
    expect(details).toContainEqual({ label: "希望日", value: "2026-10-20 / 2026-10-21" })
    expect(details).toContainEqual({ label: "都合の悪い日", value: "2026-10-22" })
    expect(displayBookingDetails(details)).toContainEqual({ label: "納品希望日", value: "2026/10/25(日)" })
    expect(displayBookingDetails(details)).toContainEqual({ label: "希望日", value: "2026/10/20(火) / 2026/10/21(水)" })
    expect(displayBookingDetails(details)).toContainEqual({ label: "都合の悪い日", value: "2026/10/22(木)" })
  })
  it("reads aliases without inferring customer duration or unsupported presets", () => {
    expect(normalizeJobKind("cm-30s")).toBe("cm")
    expect(normalizeJobKind("drama-follow-up")).toBe("drama")
    expect(workflowPresetJobKind("cm")).toBe("cm-30s")
    expect(workflowPresetJobKind("documentary")).toBeUndefined()
    expect(normalizeJobKind("unknown")).toBeUndefined()
    expect(normalizeJobKind("toString")).toBeUndefined()
  })
})
