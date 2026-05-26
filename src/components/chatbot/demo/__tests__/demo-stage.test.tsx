// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DemoStage } from "@/components/chatbot/demo/DemoStage"
import type { DemoScript } from "@/lib/chatbot/demo"

const script: DemoScript = {
  id: "stage-test",
  title: "ステージテスト",
  initialPoint: { xRatio: 0.6, yRatio: 0.6 },
  steps: [
    {
      id: "annotate",
      kind: "annotate",
      target: { xRatio: 0.6, yRatio: 0.6 },
      durationMs: 100,
      annotation: {
        title: "確認して予約する",
        body: "内容を確認して進みます。",
        placement: "left",
      },
    },
  ],
}

describe("DemoStage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true })
  })

  afterEach(() => cleanup())

  it("keeps children and renders overlay", () => {
    render(
      <DemoStage script={script} cursorLabel="操作位置">
        <div>予約フォーム</div>
      </DemoStage>,
    )

    expect(screen.getByText("予約フォーム")).toBeInTheDocument()
    expect(screen.getByText("操作位置")).toBeInTheDocument()
    expect(screen.getByText("確認して予約する")).toBeInTheDocument()
  })

  it("can hide the overlay while keeping children", () => {
    render(
      <DemoStage script={script} active={false}>
        <div>予約フォーム</div>
      </DemoStage>,
    )

    expect(screen.getByText("予約フォーム")).toBeInTheDocument()
    expect(screen.queryByText("確認して予約する")).not.toBeInTheDocument()
  })
})
