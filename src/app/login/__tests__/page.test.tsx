// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MAGIC_LINK_PROVIDER_ID } from "@/lib/auth/provider-ids"
import LoginPage from "../page"

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

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => ({
    emailNotVerified: "メールアドレスの確認が完了していません。",
    invalidCredentials: "メールアドレスまたはパスワードが正しくありません。",
    loginFailed: "ログインに失敗しました。",
    magicFailed: "ログインリンクを送信できませんでした。",
    login: "ログイン",
    loginIntro: "予約管理へログインします。",
    verified: "メールアドレスを確認しました。",
    verifyError: "確認リンクが無効か期限切れです。",
    email: "メールアドレス",
    password: "パスワード",
    passwordPlaceholder: "パスワードを入力",
    signingIn: "ログイン中…",
    forgotPassword: "パスワードをお忘れですか？",
    magicTitle: "メールリンクでログイン",
    magicIntro: "メールで届くリンクからログインできます。",
    magicEmail: "ログインリンク送信用メールアドレス",
    magicSent: "ログインリンクを送信しました。メールをご確認ください。",
    sending: "送信中…",
    sendMagic: "ログインリンクを送信",
    or: "または",
    googleLogin: "Googleでログイン",
    twitterLogin: "Xでログイン",
    lineLogin: "LINEでログイン",
    noAccount: "アカウントをお持ちでない方",
    signup: "新規登録",
  })[key] ?? key,
}))

describe("LoginCard", () => {
  beforeEach(() => {
    mocks.signIn.mockReset()
    mocks.searchParams = new URLSearchParams()
  })

  afterEach(() => cleanup())

  it("keeps the credentials login on the credentials provider", async () => {
    mocks.signIn.mockResolvedValueOnce({ error: "CredentialsSignin", code: "invalid_credentials" })

    render(<LoginPage />)
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

    render(<LoginPage />)
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

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText("ログインリンク送信用メールアドレス"), {
      target: { value: "magic@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    expect(await screen.findByText("ログインリンクを送信しました。メールをご確認ください。")).toBeInTheDocument()
  })

  it("does not submit a magic link when email is empty", () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }))

    expect(mocks.signIn).not.toHaveBeenCalled()
  })
})
