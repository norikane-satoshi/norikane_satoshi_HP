import { describe, expect, it } from "vitest"

import { bookingApiSchema, mapErrorCodeToJa } from "@/lib/booking/domain/api-schema"

function validBooking(overrides: Record<string, unknown> = {}) {
  return {
    projectTitle: "Color grading",
    dueDate: "2026-06-30",
    companyName: "NCS",
    contactName: "Satoshi",
    sessionEmail: "satoshi@example.com",
    contactEmail: "",
    phone: "",
    memo: "",
    agreed: true,
    selectedSlots: [
      {
        start: "2026-06-10T01:00:00.000Z",
        end: "2026-06-10T02:00:00.000Z",
      },
    ],
    ...overrides,
  }
}

describe("bookingApiSchema", () => {
  it("accepts personal bookings without teamId", () => {
    const parsed = bookingApiSchema.safeParse(validBooking({ teamId: null }))

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.teamId).toBeNull()
  })

  it("accepts team bookings with teamId", () => {
    const parsed = bookingApiSchema.safeParse(validBooking({ teamId: "team_1" }))

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.teamId).toBe("team_1")
  })

  it("rejects blank project titles, invalid contact email, and empty team ids", () => {
    expect(bookingApiSchema.safeParse(validBooking({ projectTitle: "" })).success).toBe(false)
    expect(bookingApiSchema.safeParse(validBooking({ contactEmail: "not-an-email" })).success).toBe(false)
    expect(bookingApiSchema.safeParse(validBooking({ teamId: "" })).success).toBe(false)
  })

  it("rejects empty selectedSlots", () => {
    const parsed = bookingApiSchema.safeParse(validBooking({ selectedSlots: [] }))

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join(".") === "selectedSlots")).toBe(true)
    }
  })

  it("rejects reversed slots", () => {
    const parsed = bookingApiSchema.safeParse(
      validBooking({
        selectedSlots: [
          {
            start: "2026-06-10T02:00:00.000Z",
            end: "2026-06-10T01:00:00.000Z",
          },
        ],
      }),
    )

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("終了時刻は開始時刻より後にしてください")
    }
  })

  it("rejects equal start/end slots", () => {
    const parsed = bookingApiSchema.safeParse(
      validBooking({
        selectedSlots: [
          {
            start: "2026-06-10T01:00:00.000Z",
            end: "2026-06-10T01:00:00.000Z",
          },
        ],
      }),
    )

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["selectedSlots", 0, "end"])
    }
  })
})

describe("mapErrorCodeToJa", () => {
  it("maps all public booking API error codes", () => {
    expect(mapErrorCodeToJa("slot_taken")).toBe("この時間枠は既に予約が確定しています")
    expect(mapErrorCodeToJa("unauthorized")).toBe("セッションが切れました、ログインし直してください")
    expect(mapErrorCodeToJa("invalid_request")).toBe("入力内容に不備があります")
    expect(mapErrorCodeToJa("unknown")).toBe("予約申込で予期せぬエラーが発生しました")
  })

  it("falls back to unknown for null and unregistered codes", () => {
    expect(mapErrorCodeToJa(null)).toBe("予約申込で予期せぬエラーが発生しました")
    expect(mapErrorCodeToJa("future_code")).toBe("予約申込で予期せぬエラーが発生しました")
  })
})
