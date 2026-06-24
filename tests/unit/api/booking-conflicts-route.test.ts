import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  evaluateConflicts: vi.fn(),
  findConflictingBookings: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/booking/domain/conflicts", () => ({
  evaluateConflicts: mocks.evaluateConflicts,
}))
vi.mock("@/lib/booking/server/conflicts", () => ({
  findConflictingBookings: mocks.findConflictingBookings,
}))

import { POST } from "@/app/api/booking/conflicts/route"

function conflictRequest(body: unknown, headers?: HeadersInit) {
  return new NextRequest("http://localhost/api/booking/conflicts", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  })
}

describe("POST /api/booking/conflicts edge branches", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 413 before auth when the request body is too large", async () => {
    const response = await POST(conflictRequest({}, { "content-length": "65537" }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: "payload_too_large" })
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.findConflictingBookings).not.toHaveBeenCalled()
  })

  it("returns invalid_request for malformed JSON after auth", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })

    const response = await POST(conflictRequest("{"))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" })
    expect(mocks.findConflictingBookings).not.toHaveBeenCalled()
  })
})
