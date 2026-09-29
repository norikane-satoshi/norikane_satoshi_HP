import { prisma } from "@/lib/prisma"
import { claimChatBookingsForVerifiedUser } from "./claim-chat-bookings"

export type BookingHistoryItem = {
  id: string
  createdAt: string
  status: string
  statusLabel: string
  requestedDates: string[]
  projectTitle: string
  contactName: string
  companyName: string | null
  memo: string | null
  customerEmail: string | null
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function statusLabel(status: string): string {
  if (status === "NEEDS_SCHEDULE") return "受付済み"
  if (status === "CONFIRMED") return "日程確定"
  if (status === "PENDING_GCAL") return "連携中"
  if (status === "FAILED") return "要確認"
  if (status === "CANCELLED") return "キャンセル"
  return status
}

function extractRequestedDatesFromMemo(memo: string | null): string[] {
  if (!memo) return []
  const match = memo.match(/^希望日:\s*(.+)$/mu)
  return match?.[1]?.trim() ? [match[1].trim()] : []
}

function expandDateOnlyRange(start: string, endExclusive: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(endExclusive)) return []
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00.000Z`)
  const end = new Date(`${endExclusive}T00:00:00.000Z`)
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export async function listBookingHistoryForUser(userId: string): Promise<BookingHistoryItem[]> {
  await claimChatBookingsForVerifiedUser(userId)
  const rows = await prisma.bookingGroup.findMany({
    where: {
      customer: { userId },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      status: true,
      projectTitle: true,
      contactName: true,
      companyName: true,
      memo: true,
      customerEmail: true,
      timeSlots: {
        orderBy: { startTime: "asc" },
        select: {
          startTime: true,
        },
      },
      calendarEvents: {
        where: { dateOnly: true, status: { not: "CANCELLED" } },
        orderBy: { startValue: "asc" },
        select: { startValue: true, endValue: true },
      },
    },
  })

  return rows.map((row) => {
    const slotDateKeys = Array.from(new Set(row.timeSlots.map((slot) => dateKey(slot.startTime))))
    const requestedDateKeys = Array.from(new Set(
      row.calendarEvents.flatMap((event) => expandDateOnlyRange(event.startValue, event.endValue)),
    )).sort()
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      statusLabel: statusLabel(row.status),
      requestedDates: slotDateKeys.length > 0
        ? slotDateKeys
        : requestedDateKeys.length > 0
          ? requestedDateKeys
          : extractRequestedDatesFromMemo(row.memo),
      projectTitle: row.projectTitle,
      contactName: row.contactName,
      companyName: row.companyName,
      memo: row.memo,
      customerEmail: row.customerEmail,
    }
  })
}
