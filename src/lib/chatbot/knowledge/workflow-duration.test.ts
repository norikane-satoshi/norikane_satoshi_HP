import { describe, expect, it } from "vitest"

import { describeJobForEstimate } from "@/lib/chatbot/knowledge/workflow-duration"

describe("describeJobForEstimate", () => {
  it("uses the length the customer chose", () => {
    expect(describeJobForEstimate("cm-30s", 0.25)).toBe("CM 15秒")
    expect(describeJobForEstimate("mv-5m", 3)).toBe("MV 3分")
    expect(describeJobForEstimate("live-60m", 150)).toBe("ライブ 2時間30分")
  })

  it("keeps the length unconfirmed instead of choosing a reference length", () => {
    expect(describeJobForEstimate("cm-30s", undefined)).toBe("CM（尺未確認）")
    expect(describeJobForEstimate("vertical-60s", undefined)).toBe("縦型動画（尺未確認）")
  })

  it("names drama episodes by their per-episode length once it is known", () => {
    expect(describeJobForEstimate("drama-first", undefined)).toBe("ドラマ初回")
    expect(describeJobForEstimate("drama-follow-up", 45)).toBe("ドラマ2話目以降（1話45分）")
    expect(describeJobForEstimate("drama-first", 5)).toBe("ドラマ初回（1話5分）")
  })
})
