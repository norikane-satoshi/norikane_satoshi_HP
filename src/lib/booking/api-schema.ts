import { z } from "zod"

import { bookingFormSchema } from "@/lib/booking/form-schema"

const slotSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
})

export const bookingApiSchema = bookingFormSchema
  .extend({
    selectedSlot: slotSchema.optional(),
    selectedSlots: z.array(slotSchema).min(1).optional(),
  })
  .superRefine((value, context) => {
    const slots = value.selectedSlots ?? (value.selectedSlot ? [value.selectedSlot] : [])
    if (slots.length === 0) {
      context.addIssue({
        code: "custom",
        message: "予約日時を選択してください",
        path: ["selectedSlots"],
      })
      return
    }

    slots.forEach((slot, index) => {
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
    bookingKind: z.enum(["confirmed", "tentative"]),
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
  | { verdict: "block"; reason: "slot_taken" | "slot_pending"; message: string }
  | { verdict: "warn"; message: string }

export type BookingApiErrorCode =
  | "slot_taken"
  | "slot_pending"
  | "tentative_exists"
  | "unauthorized"
  | "invalid_request"
  | "unknown"

export function mapErrorCodeToJa(code: string | null | undefined): string {
  const messages = {
    slot_taken: "この時間枠は既に予約が確定しています",
    slot_pending: "この時間枠は他のお客様の本予約申込が入っており確定待ちです",
    tentative_exists: "この時間枠は既に他のお客様の仮キープが入っています",
    unauthorized: "セッションが切れました、ログインし直してください",
    invalid_request: "入力内容に不備があります",
    unknown: "予約申込で予期せぬエラーが発生しました",
  } satisfies Record<BookingApiErrorCode, string>

  return messages[(code ?? "unknown") as BookingApiErrorCode] ?? messages.unknown
}
