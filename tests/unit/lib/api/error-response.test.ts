import { afterEach, describe, expect, it, vi } from "vitest"

import { respondInternalError } from "@/lib/api/server/error-response"

describe("respondInternalError", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("does not expose details in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.spyOn(console, "error").mockImplementation(() => {})

    const response = respondInternalError(new Error("db password leaked"), "test")

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "INTERNAL_ERROR" })
  })

  it("includes detail in test", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.spyOn(console, "error").mockImplementation(() => {})

    const response = respondInternalError(new Error("db down"), "test")

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "INTERNAL_ERROR", detail: "db down" })
  })
})
