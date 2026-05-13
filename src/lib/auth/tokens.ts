import { randomBytes } from "node:crypto"

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

export function newToken(): string {
  return randomBytes(32).toString("base64url")
}
