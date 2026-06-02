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
    expect(container).toHaveTextContent("1 週間")
    expect(container).toHaveTextContent("本人")
    expect(container).toHaveTextContent("空き状況")
    expect(container).toHaveTextContent("予約が埋まっている時間帯")
    expect(container).toHaveTextContent("Cookie・セッション識別子")
    expect(container).toHaveTextContent("外部の業務委託先やクラウドサービス")
    expect(container).not.toHaveTextContent("Free/Busy")
    expect(container).not.toHaveTextContent("busy 時間帯")
    expect(container).not.toHaveTextContent("Resend")
    expect(container).not.toHaveTextContent("Vercel")
    expect(container).not.toHaveTextContent("Turso")
    expect(container).not.toHaveTextContent("Auth providers")
    expect(container).not.toHaveTextContent("Google")
    expect(container).not.toHaveTextContent("session id")
    expect(container).toHaveTextContent("norikane.satoshi@gmail.com")
  })
})
