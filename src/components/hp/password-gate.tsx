"use client"

import { useState, useSyncExternalStore } from "react"
import { Lock, Unlock } from "lucide-react"

const STORAGE_KEY = "hp_calendar_auth"
const AUTH_CHANGE_EVENT = "hp-calendar-auth-change"

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(AUTH_CHANGE_EVENT, callback)

  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(AUTH_CHANGE_EVENT, callback)
  }
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "true"
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const authenticated = useSyncExternalStore(subscribe, getSnapshot, () => false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const correctPassword = process.env.NEXT_PUBLIC_CALENDAR_PASSWORD
    if (password === correctPassword) {
      localStorage.setItem(STORAGE_KEY, "true")
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
      setError("")
    } else {
      setError("パスワードが正しくありません")
    }
  }

  if (authenticated) {
    return <>{children}</>
  }

  return (
    <div className="glass-card p-8 md:p-12">
      <div className="text-center max-w-md mx-auto">
        <div className="glass-inset w-16 h-16 mx-auto mb-6 flex items-center justify-center rounded-full">
          <Lock className="h-7 w-7 text-hp-muted" />
        </div>
        <h2 className="text-xl font-semibold text-hp mb-2">
          Schedule
        </h2>
        <p className="text-sm text-hp-muted mb-6">
          予約カレンダーの閲覧にはパスワードが必要です。
          <br />
          お問い合わせ後にパスワードをお伝えします。
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError("")
            }}
            placeholder="パスワードを入力"
            className="glass-input px-4 py-3 text-center text-sm"
          />
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          <button
            type="submit"
            className="glass-btn px-6 py-3 text-sm font-medium text-hp flex items-center justify-center gap-2"
          >
            <Unlock className="h-4 w-4" />
            解除
          </button>
        </form>
      </div>
    </div>
  )
}
