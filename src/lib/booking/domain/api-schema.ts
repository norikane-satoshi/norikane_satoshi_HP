import { z } from "zod"

import { bookingFormSchema, isValidBookingDateRange } from "@/lib/booking/domain/form-schema"

const slotSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
})

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const bookingApiSchema = bookingFormSchema
  .extend({
    entryPoint: z.enum(["web", "line_liff"]).optional(),
    teamId: z.string().min(1).nullable().optional(),
    selectedSlots: z.array(slotSchema).default([]),
    requestedDateRange: dateRangeSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.selectedSlots.length === 0 && !value.requestedDateRange) {
      context.addIssue({
        code: "custom",
        message: "相談希望日を選択してください",
        path: ["requestedDateRange"],
      })
    }
    if (value.requestedDateRange && !isValidBookingDateRange(value.requestedDateRange)) {
      context.addIssue({
        code: "custom",
        message: "相談希望日の終了日は開始日以降にしてください",
        path: ["requestedDateRange", "endDate"],
      })
    }
    value.selectedSlots.forEach((slot, index) => {
      const start = new Date(slot.start)
      const end = new Date(slot.end)

      if (start >= end) {
        context.addIssue({
          code: "custom",
          message: "終了時刻は開始時刻より後にしてください",
          path: ["selectedSlots", index, "end"],
        })
      }
    })
  })

export type BookingApiInput = z.infer<typeof bookingApiSchema>

export const bookingConflictsRequestSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    excludeBookingId: z.string().optional(),
  })
  .superRefine((value, context) => {
    const start = new Date(value.start)
    const end = new Date(value.end)
    if (start >= end) {
      context.addIssue({
        code: "custom",
        message: "終了時刻は開始時刻より後にしてください",
        path: ["end"],
      })
    }
  })

export type BookingConflictsRequest = z.infer<typeof bookingConflictsRequestSchema>

export type BookingConflictsResponse =
  | { verdict: "ok" }
  | { verdict: "block"; reason: "slot_taken"; message: string }

export type BookingApiErrorCode =
  | "slot_taken"
  | "unauthorized"
  | "invalid_request"
  | "calendar_unavailable"
  | "unknown"

export function mapErrorCodeToJa(code: string | null | undefined): string {
  const messages = {
    slot_taken: "この時間枠は既に予約が確定しています",
    unauthorized: "セッションが切れました、ログインし直してください",
    invalid_request: "入力内容に不備があります",
    calendar_unavailable: "カレンダー連携に一時的な問題が発生しています。時間をおいて再度お試しください",
    unknown: "予約申込で予期せぬエラーが発生しました",
  } satisfies Record<BookingApiErrorCode, string>

  return messages[(code ?? "unknown") as BookingApiErrorCode] ?? messages.unknown
}
