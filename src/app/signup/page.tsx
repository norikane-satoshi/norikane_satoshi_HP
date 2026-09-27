"use client"

import { FormEvent, Suspense, useState } from "react"
import {useTranslations} from "next-intl"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import {Link} from "@/i18n/navigation"

const FALLBACK_CALLBACK_URL = "/booking"

function SignupCard() {
  const t = useTranslations("Auth")
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") || FALLBACK_CALLBACK_URL

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setErrorMessage(null)

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          password,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setErrorMessage(typeof data?.error === "string" ? data.error : t("registrationFailed"))
        setSubmitting(false)
        return
      }

      setSentTo(email.trim())
    } catch {
      setErrorMessage(t("networkError"))
      setSubmitting(false)
    }
  }

  const socialSignIn = (provider: "google" | "twitter" | "line") => {
    signIn(provider, { callbackUrl })
  }

  const loginHref =
    callbackUrl === FALLBACK_CALLBACK_URL
      ? "/login"
      : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`

  if (sentTo) {
    return (
      <div className="glass-card p-8 md:p-10 text-center">
        <h1 className="text-3xl font-bold text-hp md:text-4xl">{t("confirmationSent")}</h1>
        <p className="mt-6 text-sm text-hp-muted">
          <span className="text-hp font-medium">{sentTo}</span>{" "}
          {t("sentTo")}
        </p>
        <p className="mt-3 text-sm text-hp-muted">
          {t("verifyInbox")}
        </p>
        <p className="mt-8 text-center text-sm text-hp-muted">
          <Link href={loginHref} className="text-hp font-medium underline decoration-dotted underline-offset-4">
            {t("backToLogin")}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card p-8 md:p-10">
      <h1 className="text-3xl font-bold text-hp md:text-4xl">{t("signup")}</h1>
      <p className="mt-3 text-sm text-hp-muted">
        {t("signupIntro")}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-hp mb-2">
            {t("name")} <span className="text-hp-muted">({t("optional")})</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="glass-input w-full px-4 py-3 text-sm"
            placeholder={t("namePlaceholder")}
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-hp mb-2">
            {t("email")} <span className="text-red-400">*</span>
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
            {t("password")} <span className="text-red-400">*</span>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="glass-input w-full px-4 py-3 text-sm"
            placeholder={t("passwordPlaceholder")}
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
          {submitting ? t("registering") : t("register")}
        </button>
      </form>

      <div className="mt-8 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--glass-border)]" />
        <span className="text-xs uppercase tracking-[0.18em] text-hp-muted">{t("or")}</span>
        <span className="h-px flex-1 bg-[var(--glass-border)]" />
      </div>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={() => socialSignIn("google")}
          className="glass-btn w-full px-6 py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          {t("googleSignup")}
        </button>
        <button
          type="button"
          onClick={() => socialSignIn("twitter")}
          className="glass-btn w-full px-6 py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          {t("twitterSignup")}
        </button>
        <button
          type="button"
          onClick={() => socialSignIn("line")}
          className="glass-btn w-full px-6 py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          {t("lineSignup")}
        </button>
      </div>

      <p className="mt-8 text-center text-sm text-hp-muted">
        {t("hasAccount")}{" "}
        <Link href={loginHref} className="text-hp font-medium underline decoration-dotted underline-offset-4">
          {t("login")}
        </Link>
      </p>
    </div>
  )
}

export default function SignupPage() {
  return (
    <section className="mx-auto w-full max-w-[480px] px-4 md:px-8 py-12 md:py-16">
      <Suspense fallback={null}>
        <SignupCard />
      </Suspense>
    </section>
  )
}
