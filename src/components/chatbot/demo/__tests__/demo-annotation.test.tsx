// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DemoAnnotation } from "@/components/chatbot/demo/DemoAnnotation"

describe("DemoAnnotation", () => {
  afterEach(() => cleanup())

  it("renders title, body, and placement", () => {
    render(
      <DemoAnnotation
        title="予約画面へ進む"
        body="必要な項目を確認します。"
        placement="left"
        target={{ xRatio: 0.7, yRatio: 0.4 }}
      />,
    )

    expect(screen.getByRole("status")).toHaveAttribute("data-placement", "left")
    expect(screen.getByText("予約画面へ進む")).toBeInTheDocument()
    expect(screen.getByText("必要な項目を確認します。")).toBeInTheDocument()
  })

  it("does not render when hidden", () => {
    const { container } = render(
      <DemoAnnotation title="非表示" body="表示しません。" target={{ xRatio: 0.5, yRatio: 0.5 }} visible={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
