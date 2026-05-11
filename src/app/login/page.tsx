"use client"

import { FormEvent, Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"

const FALLBACK_CALLBACK_URL = "/booking"

function messageForCode(code: string | null | undefined): string {
  if (code === "email_not_verified") {
    return "メール認証が未完了です。受信メールのリンクから認証してください"
  }
  if (code === "invalid_credentials") {
    return "メールかパスワードが違います"
  }
  return "ログインに失敗しました"
}

function LoginCard() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") || FALLBACK_CALLBACK_URL

  const [verified, setVerified] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  useEffect(() => {
    setVerified(searchParams.get("verified"))
    setVerifyError(searchParams.get("verifyError"))
  }, [searchParams])

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setErrorMessage(null)

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    })

    if (result?.error) {
      setErrorMessage(messageForCode(result.code))
      setSubmitting(false)
      return
    }

    window.location.assign(result?.url ?? callbackUrl)
  }

  const socialSignIn = (provider: "google" | "twitter" | "line") => {
    signIn(provider, { callbackUrl })
  }

  const signupHref =
    callbackUrl === FALLBACK_CALLBACK_URL
      ? "/signup"
      : `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`

  return (
    <div className="glass-card p-8 md:p-10">
      <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">Login</p>
      <h1 className="mt-2 text-3xl font-bold text-hp md:text-4xl">ログイン</h1>
      <p className="mt-3 text-sm text-hp-muted">
        ご登録のメールアドレスとパスワード、またはソーシャルログインでサインインしてください。
      </p>

      {verified === "1" && (
        <p className="mt-6 text-sm text-emerald-500" role="status">
          メールアドレスの認証が完了しました。ログインしてください
        </p>
      )}
      {verifyError === "invalid_or_expired" && (
        <p className="mt-6 text-sm text-red-500" role="alert">
          認証リンクが無効か期限切れです。お手数ですがもう一度サインアップから登録メールを送信してください
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-hp mb-2">
            メールアドレス <span className="text-red-400">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="glass-input w-full px-4 py-3 text-sm"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-hp mb-2">
            パスワード <span className="text-red-400">*</span>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="glass-input w-full px-4 py-3 text-sm"
            placeholder="8文字以上"
          />
        </div>

        {errorMessage && (
          <p className="text-sm text-red-500" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="glass-btn w-full px-6 py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting ? "サインイン中..." : "ログイン"}
        </button>

        <p className="text-center text-sm text-hp-muted">
          <Link
            href="/forgot-password"
            className="underline decoration-dotted underline-offset-4 hover:text-hp"
          >
            パスワードをお忘れですか？
          </Link>
        </p>
      </form>

      <div className="mt-8 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--glass-border)]" />
        <span className="text-xs uppercase tracking-[0.18em] text-hp-muted">または</span>
        <span className="h-px flex-1 bg-[var(--glass-border)]" />
      </div>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={() => socialSignIn("google")}
          className="glass-btn w-full px-6 py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          Google でログイン
        </button>
        <button
          type="button"
          onClick={() => socialSignIn("twitter")}
          className="glass-btn w-full px-6 py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          X (Twitter) でログイン
        </button>
        <button
          type="button"
          onClick={() => socialSignIn("line")}
          className="glass-btn w-full px-6 py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          LINE でログイン
        </button>
      </div>

      <p className="mt-8 text-center text-sm text-hp-muted">
        アカウントをお持ちでないですか？{" "}
        <Link href={signupHref} className="text-hp font-medium underline decoration-dotted underline-offset-4">
          新規登録
        </Link>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <section className="mx-auto w-full max-w-[480px] px-4 md:px-8 py-12 md:py-16">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </section>
  )
}
