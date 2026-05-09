import { z } from "zod"

export type BookingStep = "calendar" | "form" | "confirm" | "done"

export type BookingSlot = {
  start: string
  end: string
}

const optionalEmail = z
  .string()
  .trim()
  .refine((value) => value === "" || z.string().email().safeParse(value).success, {
    message: "メールアドレスの形式で入力してください",
  })

export const bookingFormSchema = z.object({
  bookingKind: z.enum(["confirmed", "tentative"], {
    message: "予約種別を選択してください",
  }),
  projectTitle: z.string().trim().min(1, "案件名を入力してください").max(100, "100 字以内で入力してください"),
  dueDate: z.string(),
  companyName: z.string().trim().max(100, "100 字以内で入力してください"),
  contactName: z.string().trim().min(1, "担当者氏名を入力してください").max(100, "100 字以内で入力してください"),
  sessionEmail: z.string().email("認証済みメールアドレスを確認できません"),
  contactEmail: optionalEmail,
  phone: z.string().trim().max(50, "50 字以内で入力してください"),
  memo: z.string().trim().max(1000, "1000 字以内で入力してください"),
  agreed: z.boolean().refine((value) => value, {
    message: "規約への同意が必要です",
  }),
})

export type BookingFormData = z.infer<typeof bookingFormSchema>

export function createDefaultBookingFormData(sessionEmail: string): BookingFormData {
  return {
    bookingKind: "confirmed",
    projectTitle: "",
    dueDate: "",
    companyName: "",
    contactName: "",
    sessionEmail,
    contactEmail: "",
    phone: "",
    memo: "",
    agreed: false,
  }
}

export function getSlotDurationMinutes(slot: BookingSlot): number {
  const start = new Date(slot.start).getTime()
  const end = new Date(slot.end).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.round((end - start) / 60000)
}

export function getTotalDurationMinutes(slots: BookingSlot[]): number {
  return slots.reduce((total, slot) => total + getSlotDurationMinutes(slot), 0)
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return "0 時間"
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours === 0) return `${restMinutes} 分`
  if (restMinutes === 0) return `${hours} 時間`
  return `${hours} 時間 ${restMinutes} 分`
}
