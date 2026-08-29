"use client"

import { Link2Off } from "lucide-react"
import { useState } from "react"
import {useLocale} from "next-intl"
import {getLocalizedCopy} from "@/i18n/copy"

type AdminReconnectBannerProps = {
  isCalendarAdmin: boolean
  code: string | null
}

export function shouldShowAdminReconnectBanner(
  isCalendarAdmin: boolean,
  code: string | null,
  dismissed: boolean,
): boolean {
  if (!isCalendarAdmin) return false
  if (code !== "calendar_token_revoked") return false
  if (dismissed) return false
  return true
}

export function AdminReconnectBanner({ isCalendarAdmin, code }: AdminReconnectBannerProps) {
  const copy = getLocalizedCopy(useLocale(), "Booking")
  const [dismissed, setDismissed] = useState(false)

  if (!shouldShowAdminReconnectBanner(isCalendarAdmin, code, dismissed)) return null

  return (
    <div className="admin-reconnect-banner glass-flat" role="alert" aria-live="polite">
      <Link2Off
        aria-hidden="true"
        size={20}
        className="admin-reconnect-banner__icon"
      />
      <div className="admin-reconnect-banner__body">
        <p className="admin-reconnect-banner__message">
          {copy.reconnectMessage}
        </p>
      </div>
      <div className="admin-reconnect-banner__actions">
        <a
          href="/api/calendar/auth"
          target="_blank"
          rel="noopener noreferrer"
          className="glass-btn admin-reconnect-banner__cta"
          aria-label={copy.reconnectLabel}
        >
          {copy.reconnect}
        </a>
        <button
          type="button"
          className="admin-reconnect-banner__dismiss"
          aria-label={copy.closeBanner}
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </div>
    </div>
  )
}
