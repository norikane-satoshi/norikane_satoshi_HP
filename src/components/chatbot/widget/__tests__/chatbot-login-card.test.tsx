// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatbotLoginCard } from "@/components/chatbot/widget/ChatbotLoginCard"
import { MAGIC_LINK_PROVIDER_ID } from "@/lib/auth/provider-ids"

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
}))

vi.mock("next-auth/react", () => ({
  signIn: mocks.signIn,
}))

describe("ChatbotLoginCard", () => {
  beforeEach(() => {
    mocks.signIn.mockReset()
  })

  afterEach(() => cleanup())

  it("passes the callbackUrl to Google, X, and LINE sign-in", () => {
    render(<ChatbotLoginCard callbackUrl="/booking/new" />)

    fireEvent.click(screen.getByRole("button", { name: "Google" }))
    fireEvent.click(screen.getByRole("button", { name: "X" }))
    fireEvent.click(screen.getByRole("button", { name: "LINE" }))

    expect(mocks.signIn).toHaveBeenNthCalledWith(1, "google", { callbackUrl: "/booking/new" })
    expect(mocks.signIn).toHaveBeenNthCalledWith(2, "twitter", { callbackUrl: "/booking/new" })
    expect(mocks.signIn).toHaveBeenNthCalledWith(3, "line", { callbackUrl: "/booking/new" })
  })

  it("sends a magic link with the callbackUrl", async () => {
    mocks.signIn.mockResolvedValueOnce({})
    const onMagicLinkSent = vi.fn()
    render(<ChatbotLoginCard callbackUrl="/booking/new" onMagicLinkSent={onMagicLinkSent} />)

    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: " client@example.com " } })
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    await waitFor(() => {
      expect(mocks.signIn).toHaveBeenCalledWith(MAGIC_LINK_PROVIDER_ID, {
        email: "client@example.com",
        redirect: false,
        callbackUrl: "/booking/new",
      })
    })
    expect(onMagicLinkSent).toHaveBeenCalledWith("client@example.com")
  })

  it("does not submit a magic link when email is empty", () => {
    render(<ChatbotLoginCard callbackUrl="/booking/new" />)
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it("uses /booking as the default callbackUrl", async () => {
    mocks.signIn.mockResolvedValueOnce({})
    render(<ChatbotLoginCard />)

    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "client@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    await waitFor(() => {
      expect(mocks.signIn).toHaveBeenCalledWith(MAGIC_LINK_PROVIDER_ID, {
        email: "client@example.com",
        redirect: false,
        callbackUrl: "/booking",
      })
    })
  })
})

