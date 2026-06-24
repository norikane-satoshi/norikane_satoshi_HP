import { timingSafeEqual } from "node:crypto"

const authorizationHeader = "authorization"
const bearerPrefix = "Bearer "

export type HostedWorkerAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: "auth" | "missing_token"; message: string }

export function authorizeHostedWorkerRequest(
  headers: Headers,
  expectedToken: string | undefined,
): HostedWorkerAuthResult {
  const configuredToken = expectedToken?.trim()
  if (!configuredToken) {
    return {
      ok: false,
      status: 503,
      code: "missing_token",
      message: "Hosted worker token is not configured.",
    }
  }

  const authorization = headers.get(authorizationHeader)
  if (!authorization?.startsWith(bearerPrefix)) {
    return {
      ok: false,
      status: 401,
      code: "auth",
      message: "Hosted worker bearer token is required.",
    }
  }

  const actualToken = authorization.slice(bearerPrefix.length)
  if (!tokensMatch(actualToken, configuredToken)) {
    return {
      ok: false,
      status: 401,
      code: "auth",
      message: "Hosted worker bearer token is invalid.",
    }
  }

  return { ok: true }
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(actualBuffer, expectedBuffer)
}
