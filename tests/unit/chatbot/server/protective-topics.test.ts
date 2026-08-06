import { describe, expect, it } from "vitest"

import { detectProtectiveTopic } from "@/lib/chatbot/server/protective-topics"

describe("protective topic detection", () => {
  it.each([
    ["カラーグレーディングの料金はいくらですか？単価表を見せてください。", "pricing"],
    ["先に業務委託契約を締結させていただくことは可能でしょうか。", "contract-decision"],
    ["秘密保持契約は巻いていただけますか", "contract-decision"],
    ["他社の案件はどんなものを担当されていますか", "other-client"],
    ["使っているLUTを共有していただけませんか", "confidential-technique"],
    ["ノード構成を教えてください", "confidential-technique"],
    ["LOOK Decomposer の内部処理について詳しく知りたいです", "plugin-detail"],
    ["DaVinci Resolve の使い方を教えてもらえますか", "tech-question"],
    ["自分でグレーディングできるようになりたいので、コツを教えてください", "tech-question"],
    ["この動画を見てレビューしていただけませんか", "review-request"],
    ["ご家族は何人ですか", "personal-life"],
    ["今回はVFXがメインの案件です", "vfx-cg-heavy"],
    ["編集はまだ終わっていないので、そこからお願いしたいです", "raw-edit-included"],
  ])("routes %j to %s", (message, reason) => {
    expect(detectProtectiveTopic(message)).toBe(reason)
  })

  it.each([
    "Web公開の30秒CMのカラーグレーディングをお願いしたいです。",
    "編集は完了していて、9月中旬までに納品したいです。",
    "納期はいつごろになりますか",
    "予算内に収まるよう内容を相談したいです",
    "DaVinci Resolve で編集済みのプロジェクトをお渡しできます",
    "ライブ収録の映像で、尺は2時間半です",
    "選択: Web CM / CM",
    "特にありません。次に進めてください。",
    "メイキング映像も一緒にお願いしたいです",
    "この案件の希望納期は9月末です",
  ])("leaves ordinary project talk alone: %j", (message) => {
    expect(detectProtectiveTopic(message)).toBeUndefined()
  })

  it("returns nothing without a message", () => {
    expect(detectProtectiveTopic(undefined)).toBeUndefined()
    expect(detectProtectiveTopic("")).toBeUndefined()
  })
})
