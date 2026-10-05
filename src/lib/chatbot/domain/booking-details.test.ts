import { expect, it } from "vitest"

import { buildBookingConfirmationItems } from "./consultation-summary"
import { jobKindChoices, projectLengthChoices, finalMediumChoices } from "./survey-choice"
import { matchChoiceAnswer } from "./choice-answer"
import { bookingDetailsMemo, confirmedBookingDetails, confirmedBookingNote } from "./booking-details"

it("uses the customer's exact duration instead of the stored estimate anchor", () => {
  const messages = [
    { id: "kind", role: "user" as const, content: "選択: 映画 / 長編 / 本編", createdAt: "2026-10-05T01:14:43Z" },
    { id: "length", role: "user" as const, content: "尺: 0時間18分", createdAt: "2026-10-05T01:14:52Z" },
    { id: "media", role: "user" as const, content: "選択: 劇場公開、Web公開", createdAt: "2026-10-05T01:15:22Z" },
  ]
  const items = buildBookingConfirmationItems({
    messages,
    jobContext: { jobKind: "feature-90m", projectLengthMinutes: 60, finalMedium: "ott", workSite: "remote-grading" },
    conversationState: {
      hasJobKind: true, hasProjectLength: true, hasFinalMedium: true,
      choiceAnswers: Object.fromEntries(messages.map((message, index) => [message.id, matchChoiceAnswer([jobKindChoices, projectLengthChoices, finalMediumChoices][index], message.content)!])),
    },
  })
  expect(items).toContainEqual({ label: "案件種別", value: "映画 / 長編 / 本編" })
  expect(items).toContainEqual({ label: "尺", value: "18分" })
  expect(items).toContainEqual({ label: "最終媒体", value: "劇場公開 / Web公開" })
  expect(items).toContainEqual({ label: "作業場所/立ち会い", value: "未確認" })
})

it("preserves a natural project correction without taking unrelated work time as length", () => {
  const details = confirmedBookingDetails({ messages: [
    { id: "a", role: "user", content: "1時間ではなく、約18分の短編ドキュメンタリーです", createdAt: "2026-10-05T01:00:00Z" },
    { id: "b", role: "user", content: "メール返信の作業は3分で済みます", createdAt: "2026-10-05T01:01:00Z" },
  ] })
  expect(details).toContainEqual({ label: "尺", value: "約18分" })
  expect(details).toContainEqual({ label: "案件種別", value: "短編ドキュメンタリー" })
  expect(details).toContainEqual({ label: "納品形式", value: "未確認" })
})

it("replaces obsolete automatic memo fields with the same confirmed details used downstream", () => {
  const memo = bookingDetailsMemo("メモ\n尺: 1時間\n最終媒体: 劇場\n作業場所: リモート", confirmedBookingDetails({}))
  expect(memo).toContain("メモ\n案件種別: 未確認\n尺: 未確認\n最終媒体: 未確認")
  expect(memo).not.toContain("1時間")
  expect(memo).not.toContain("劇場")
  expect(memo).not.toContain("リモート")
})

it("takes a direct length reply only as an answer to a length question", () => {
  const details = confirmedBookingDetails({ messages: [
    { id: "a", role: "assistant", content: "尺を教えてください", createdAt: "2026-10-05T01:00:00Z" },
    { id: "b", role: "user", content: "約18分です", createdAt: "2026-10-05T01:01:00Z" },
    { id: "c", role: "assistant", content: "会議はどのくらいかかりますか？", createdAt: "2026-10-05T01:02:00Z" },
    { id: "d", role: "user", content: "1時間です", createdAt: "2026-10-05T01:03:00Z" },
  ] })
  expect(details).toContainEqual({ label: "尺", value: "約18分" })
})

it("does not prefill a model-written note unless the customer wrote the same whole line", () => {
  const messages = [{ id: "u", role: "user" as const, content: "補足: 字幕は相談したい\n顔ぼかし30カット以上", createdAt: "2026-10-05T01:00:00Z" }]
  expect(confirmedBookingNote(messages, "1時間の長編を11月に作業\n顔ぼかし30カット以上")).toBe("字幕は相談したい\n顔ぼかし30カット以上")
})

it("clears an earlier answer when the customer retracts it without giving a replacement", () => {
  const details = confirmedBookingDetails({ messages: [
    { id: "a", role: "user", content: "案件種別: 長編\n尺: 1時間", createdAt: "2026-10-05T01:00:00Z" },
    { id: "b", role: "user", content: "長編ではありません。1時間ではありません。", createdAt: "2026-10-05T01:01:00Z" },
  ] })
  expect(details).toContainEqual({ label: "案件種別", value: "未確認" })
  expect(details).toContainEqual({ label: "尺", value: "未確認" })
})

it("does not turn populated estimate fields or flags into customer answers", () => {
  const items = buildBookingConfirmationItems({
    messages: [{ id: "u", role: "user", content: "カラグレをお願いしたいです", createdAt: "2026-10-05T01:00:00Z" }],
    jobContext: { jobKind: "feature-90m", projectLengthMinutes: 60, finalMedium: "cinema", workSite: "remote-grading", publicReleaseDate: "2026-11-01" },
    conversationState: { hasJobKind: true, hasProjectLength: true, hasFinalMedium: true, hasWorkSite: true, hasDesiredSchedule: true },
  })
  for (const label of ["案件種別", "尺", "最終媒体", "作業場所/立ち会い", "納品希望日"]) {
    expect(items).toContainEqual({ label, value: "未確認" })
  }
})

it("uses a later explicit correction and never reads assistant guesses", () => {
  const items = buildBookingConfirmationItems({
    jobContext: { jobKind: "feature-90m", projectLengthMinutes: 60 },
    messages: [
      { id: "a", role: "assistant", content: "長編1時間、劇場公開ですね", createdAt: "2026-10-05T01:00:00Z" },
      { id: "b", role: "user", content: "尺: 18分（クレジット込み）\n案件種別: 短編ドキュメンタリー\n納期: 2026-10-25", createdAt: "2026-10-05T01:01:00Z" },
    ],
  })
  expect(items).toContainEqual({ label: "尺", value: "18分（クレジット込み）" })
  expect(items).toContainEqual({ label: "案件種別", value: "短編ドキュメンタリー" })
  expect(items).toContainEqual({ label: "納品希望日", value: "2026-10-25" })
  expect(items).toContainEqual({ label: "最終媒体", value: "未確認" })
})
