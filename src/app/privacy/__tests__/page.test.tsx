// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import PrivacyPolicyPage, { metadata } from "../page"

describe("PrivacyPolicyPage", () => {
  afterEach(() => cleanup())

  it("sets the privacy policy metadata title", () => {
    expect(metadata.title).toBe("プライバシーポリシー | のりかね映像設計室")
  })

  it("renders chatbot privacy, retention, context, and contact details", () => {
    const { container } = render(<PrivacyPolicyPage />)

    expect(container).toHaveTextContent("プライバシーポリシー")
    expect(container).toHaveTextContent("30 日")
    expect(container).toHaveTextContent("本人")
    expect(container).toHaveTextContent("Free/Busy")
    expect(container).toHaveTextContent("busy 時間帯")
    expect(container).toHaveTextContent("norikane.satoshi@gmail.com")
  })
})
