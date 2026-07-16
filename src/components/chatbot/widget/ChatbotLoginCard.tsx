"use client"

import { FormEvent, useState } from "react"
import { signIn } from "next-auth/react"
import { MAGIC_LINK_PROVIDER_ID } from "@/lib/auth/provider-ids"

type ChatbotLoginCardProps = {
  callbackUrl?: string
  onMagicLinkSent?: (email: string) => void
}

const DEFAULT_CALLBACK_URL = "/booking"

export function ChatbotLoginCard({
  callbackUrl = DEFAULT_CALLBACK_URL,
  onMagicLinkSent,
}: ChatbotLoginCardProps) {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSocialSignIn = (provider: "google" | "twitter" | "line") => {
    signIn(provider, { callbackUrl })
  }

  const handleMagicLinkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return

    setSubmitting(true)
    setSent(false)
    setErrorMessage(null)

    try {
      const result = await signIn(MAGIC_LINK_PROVIDER_ID, {
        email: trimmedEmail,
        redirect: false,
        callbackUrl,
      })
      if (result?.error) {
        setErrorMessage("ログインリンクを送信できませんでした")
        return
      }
      setSent(true)
      onMagicLinkSent?.(trimmedEmail)
    } catch {
      setErrorMessage("ログインリンクを送信できませんでした")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="glass-card space-y-4 p-5" aria-label="ログイン">
      <div>
        <h2 className="text-base font-semibold text-hp">ログインして予約に進む</h2>
        <p className="mt-2 text-sm text-hp-muted">
          メールリンク、または外部アカウントでログインできます。
        </p>
      </div>

      <form onSubmit={handleMagicLinkSubmit} className="space-y-3" noValidate>
        <label htmlFor="chatbot-login-email" className="block text-sm font-medium text-hp">
          メールアドレス
        </label>
        <input
          id="chatbot-login-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="glass-input w-full px-4 py-3 text-sm"
          placeholder="you@example.com"
        />
        {sent && (
          <p className="text-sm text-hp-muted" role="status">
            ログインリンクを送信しました。メールをご確認ください。
          </p>
        )}
        {errorMessage && (
          <p className="text-sm text-red-500" role="alert">
            {errorMessage}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="glass-btn w-full px-4 py-3 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "送信中..." : "ログインリンクを送信"}
        </button>
      </form>

      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => handleSocialSignIn("google")} className="glass-btn px-3 py-2 text-sm">
          Google
        </button>
        <button type="button" onClick={() => handleSocialSignIn("twitter")} className="glass-btn px-3 py-2 text-sm">
          X
        </button>
        <button type="button" onClick={() => handleSocialSignIn("line")} className="glass-btn px-3 py-2 text-sm">
          LINE
        </button>
      </div>
    </section>
  )
}
