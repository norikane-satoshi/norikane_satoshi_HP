import { describe, expect, it } from "vitest"

import { describeJobForEstimate } from "@/lib/chatbot/knowledge/workflow-duration"

describe("describeJobForEstimate", () => {
  it("uses the length the customer chose", () => {
    expect(describeJobForEstimate("cm-30s", 0.25)).toBe("CM 15秒")
    expect(describeJobForEstimate("mv-5m", 3)).toBe("MV 3分")
    expect(describeJobForEstimate("live-60m", 150)).toBe("ライブ 2.5時間")
  })

  it("names the reference length as a condition while the length is still open", () => {
    expect(describeJobForEstimate("cm-30s", undefined)).toBe("CM（30秒の場合）")
    expect(describeJobForEstimate("vertical-60s", undefined)).toBe("縦型動画（1分の場合）")
  })

  it("names drama episodes by their per-episode length once it is known", () => {
    expect(describeJobForEstimate("drama-first", undefined)).toBe("ドラマ初回")
    expect(describeJobForEstimate("drama-follow-up", 45)).toBe("ドラマ2話目以降（1話45分）")
    expect(describeJobForEstimate("drama-first", 5)).toBe("ドラマ初回（1話5分）")
  })
})
