import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, expect, it, vi } from "vitest"

// Exercise the installed Auth.js implementation, with its adapter mocked and no mail/network.
const require = createRequire(import.meta.url)
const authRequire = createRequire(require.resolve("next-auth"))
const handlerUrl = pathToFileURL(join(dirname(authRequire.resolve("@auth/core")), "lib/actions/callback/handle-login.js")).href

afterEach(() => vi.useRealTimers())
it.each([false, true])("a successfully redeemed magic link verifies the email (existing account: %s)", async (existing) => {
  vi.useFakeTimers().setSystemTime(new Date("2026-09-29T12:00:00Z"))
  const { handleLoginOrRegister } = await import(/* @vite-ignore */ handlerUrl)
  const user = { id: "user_1", email: "owner@example.com", emailVerified: null }
  const adapter = {
    getUserByEmail: vi.fn().mockResolvedValue(existing ? user : null),
    updateUser: vi.fn(async (data) => ({ ...user, ...data })),
    createUser: vi.fn(async (data) => ({ ...user, ...data })),
  }
  const result = await handleLoginOrRegister(null, { email: user.email },
    { provider: "resend", providerAccountId: user.email, type: "email" },
    { adapter, events: {}, jwt: {}, session: { strategy: "jwt", generateSessionToken: vi.fn() } })
  expect(result.user.emailVerified).toEqual(new Date("2026-09-29T12:00:00Z"))
  expect(existing ? adapter.updateUser : adapter.createUser).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: new Date("2026-09-29T12:00:00Z") }))
})
