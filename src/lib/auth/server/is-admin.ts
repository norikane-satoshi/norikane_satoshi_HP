/* eslint-disable no-restricted-syntax -- Centralized access to the admin email env lives here. */

function getAdminEmail(): string {
  return (process.env.BOOKING_CALENDAR_ADMIN_EMAIL ?? "").trim()
}

export function getBookingCalendarAdminEmail(): string {
  return getAdminEmail()
}

/**
 * Admin 判定の唯一の窓口。文字列直比較を取り残さず、全 call site をこの関数経由に統一する。
 */
export function isAdmin(email?: string | null): boolean {
  return !!email && email.trim().toLowerCase() === getAdminEmail().toLowerCase()
}
