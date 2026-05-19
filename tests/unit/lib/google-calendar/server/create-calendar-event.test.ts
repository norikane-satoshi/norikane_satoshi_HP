import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  setCredentials: vi.fn(),
}))

vi.mock("googleapis", () => {
  class OAuth2 {
    setCredentials = mocks.setCredentials
    credentials: Record<string, unknown> = {}
  }
  return {
    google: {
      auth: { OAuth2 },
      calendar: () => ({
        events: { insert: mocks.insert },
      }),
    },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { createCalendarEvent } from "@/lib/google-calendar/server"

const baseInput = {
  calendarId: "primary",
  summary: "【予約確定】Color grading",
  description: "案件名: Color grading\n会社名: NCS",
  start: "2026-06-10T01:00:00.000Z",
  end: "2026-06-10T02:00:00.000Z",
  colorId: "9",
  accessToken: "ya29.access-token",
}

describe("createCalendarEvent", () => {
  beforeEach(() => {
    mocks.insert.mockReset()
    mocks.setCredentials.mockReset()
    process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID = "client-id"
    process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET = "client-secret"
    process.env.GOOGLE_CALENDAR_REDIRECT_URI = "http://localhost/callback"
  })

  it("stamps extendedProperties.private with source only (no customer PII)", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-1" } })

    await createCalendarEvent(baseInput)

    expect(mocks.insert).toHaveBeenCalledTimes(1)
    const args = mocks.insert.mock.calls[0][0]
    expect(args.requestBody.extendedProperties.private.source).toBe("hp-booking")
    expect(args.requestBody.extendedProperties.private.customer_name).toBeUndefined()
    expect(args.requestBody.extendedProperties.private.customer_company).toBeUndefined()
  })

  it("preserves summary, description, colorId, start, end (regression)", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-2" } })

    await createCalendarEvent(baseInput)

    const args = mocks.insert.mock.calls[0][0]
    expect(args.calendarId).toBe(baseInput.calendarId)
    expect(args.requestBody.summary).toBe(baseInput.summary)
    expect(args.requestBody.description).toBe(baseInput.description)
    expect(args.requestBody.colorId).toBe(baseInput.colorId)
    expect(args.requestBody.start).toEqual({ dateTime: baseInput.start })
    expect(args.requestBody.end).toEqual({ dateTime: baseInput.end })
  })

  it("returns the inserted event id", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-3" } })

    await expect(createCalendarEvent(baseInput)).resolves.toEqual({ id: "evt-3" })
  })

  it("throws when the API does not return an id", async () => {
    mocks.insert.mockResolvedValue({ data: {} })

    await expect(createCalendarEvent(baseInput)).rejects.toThrow(/did not return event id/)
  })
})
