// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MAGIC_LINK_PROVIDER_ID } from "@/lib/auth/provider-ids"
import { LoginCard } from "../page"

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock("next-auth/react", () => ({
  signIn: mocks.signIn,
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
}))

describe("LoginCard", () => {
  beforeEach(() => {
    mocks.signIn.mockReset()
    mocks.searchParams = new URLSearchParams()
  })

  afterEach(() => cleanup())

  it("keeps the credentials login on the credentials provider", async () => {
    mocks.signIn.mockResolvedValueOnce({ error: "CredentialsSignin", code: "invalid_credentials" })

    render(<LoginCard />)
    fireEvent.change(screen.getAllByLabelText(/メールアドレス/)[0], { target: { value: "user@example.com" } })
    fireEvent.change(screen.getByLabelText(/パスワード/), { target: { value: "password123" } })
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }))

    await waitFor(() => {
      expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
        email: "user@example.com",
        password: "password123",
        redirect: false,
        callbackUrl: "/booking",
      })
    })
  })

  it("sends the magic link through the configured email provider", async () => {
    mocks.searchParams = new URLSearchParams("callbackUrl=%2Fbooking%2Fnew")
    mocks.signIn.mockResolvedValueOnce({})

    render(<LoginCard />)
    fireEvent.change(screen.getByLabelText("ログインリンク送信用メールアドレス"), {
      target: { value: " magic@example.com " },
    })
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    await waitFor(() => {
      expect(mocks.signIn).toHaveBeenCalledWith(MAGIC_LINK_PROVIDER_ID, {
        email: "magic@example.com",
        redirect: false,
        callbackUrl: "/booking/new",
      })
    })
  })

  it("shows the magic link success message", async () => {
    mocks.signIn.mockResolvedValueOnce({})

    render(<LoginCard />)
    fireEvent.change(screen.getByLabelText("ログインリンク送信用メールアドレス"), {
      target: { value: "magic@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    expect(await screen.findByText("ログインリンクを送信しました。メールをご確認ください。")).toBeInTheDocument()
  })

  it("does not submit a magic link when email is empty", () => {
    render(<LoginCard />)
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    expect(mocks.signIn).not.toHaveBeenCalled()
  })
})
