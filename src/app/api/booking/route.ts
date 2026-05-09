import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { bookingApiSchema, type BookingApiInput } from "@/lib/booking/api-schema"
import {
  findConflictingBookings,
  resolveConflictForFinalSubmit,
} from "@/lib/booking/conflicts"
import {
  sendBookingConfirmedEmail,
  sendBookingOverwriteNoticeEmail,
  sendBookingTentativeEmail,
  type BookingEmailArgs,
} from "@/lib/booking/email"
import {
  CALENDAR_TOKEN_USER_ID,
  createCalendarEvent,
  refreshCalendarAccessToken,
  updateCalendarEvent,
} from "@/lib/google-calendar"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function createDescription(input: BookingApiInput): string {
  return [
    ["案件名", input.projectTitle],
    ["納期", input.dueDate],
    ["会社名", input.companyName],
    ["担当者氏名", input.contactName],
    ["メールアドレス", input.sessionEmail],
    ["連絡用メール", input.contactEmail],
    ["電話番号", input.phone],
    ["補足メモ", input.memo],
  ]
    .map(([label, value]) => `${label}: ${value.trim() || "-"}`)
    .join("\n")
}

function createSummary(input: BookingApiInput): string {
  const prefix = input.bookingKind === "tentative" ? "【仮キープ】" : "【予約確定】"
  return `${prefix}${input.projectTitle} / ${input.contactName}`
}

function createBookingEmailArgs(input: BookingApiInput, to: string): BookingEmailArgs {
  const slot = getInputSlots(input)[0]
  return {
    to,
    projectTitle: input.projectTitle,
    start: slot.start,
    end: slot.end,
    workScopes: [],
    otherWorkDetail: input.memo,
    estimatedDuration: "consult",
  }
}

function getInputSlots(input: BookingApiInput): { start: string; end: string }[] {
  return input.selectedSlots ?? (input.selectedSlot ? [input.selectedSlot] : [])
}

async function warnOnEmailFailure(task: Promise<unknown>, tag: string, to: string) {
  try {
    await task
  } catch (error) {
    const message = error instanceof Error ? error.message : "email send failed"
    console.warn(`[email failed] tag=${tag} to=${to}`, message)
  }
}

async function refreshStoredCalendarToken() {
  const storedToken = await prisma.calendarToken.findUnique({
    where: { userId: CALENDAR_TOKEN_USER_ID },
  })

  if (!storedToken) throw new Error("Google Calendar token is not connected")

  const refreshed = await refreshCalendarAccessToken(storedToken.refreshToken)
  await prisma.calendarToken.update({
    where: { userId: CALENDAR_TOKEN_USER_ID },
    data: {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    },
  })

  return refreshed.accessToken
}

function responseForConflict(error: string) {
  return NextResponse.json({ error }, { status: 409 })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  const userEmail = session?.user?.email

  if (!userId || !userEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = bookingApiSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const input = parsed.data

  if (userEmail !== input.sessionEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const slots = getInputSlots(input)
  const primarySlot = slots[0]
  const start = new Date(primarySlot.start)
  const end = new Date(primarySlot.end)
  const now = new Date()
  const tentativeDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID

  try {
    const customer = await prisma.customer.upsert({
      where: { userId },
      update: {
        displayName: input.contactName,
        phone: nullable(input.phone),
        companyName: nullable(input.companyName),
        notes: nullable(input.memo),
      },
      create: {
        userId,
        displayName: input.contactName,
        phone: nullable(input.phone),
        companyName: nullable(input.companyName),
        notes: nullable(input.memo),
      },
    })

    const conflictLists = await Promise.all(
      slots.map((slot) => findConflictingBookings(new Date(slot.start), new Date(slot.end))),
    )
    const conflicts = conflictLists.flat()
    const conflict = resolveConflictForFinalSubmit(conflicts, input.bookingKind)
    if (conflict) return responseForConflict(conflict)

    const tentativeConflicts = conflicts.filter((booking) => booking.status === "TENTATIVE")
    if (tentativeConflicts.length > 0) {
      const tentativeGroupIds = [...new Set(tentativeConflicts.map((booking) => booking.bookingGroupId))]
      await prisma.bookingGroup.updateMany({
        where: {
          id: { in: tentativeGroupIds },
        },
        data: {
          status: "PENDING_CONFIRMATION",
          tentativeNotifiedAt: now,
          tentativeDeadlineAt: tentativeDeadline,
        },
      })
      await prisma.bookingTimeSlot.updateMany({
        where: { bookingGroupId: { in: tentativeGroupIds } },
        data: { status: "PENDING_CONFIRMATION" },
      })
    }

    const bookingStatus = input.bookingKind === "tentative" ? "TENTATIVE" : "CONFIRMED"
    const bookingGroup = await prisma.bookingGroup.create({
      data: {
        customerId: customer.id,
        kind: bookingStatus,
        status: bookingStatus,
        projectTitle: input.projectTitle,
        memo: nullable(input.memo),
        contactName: input.contactName,
        companyName: nullable(input.companyName),
        contactEmail: nullable(input.contactEmail),
        phone: nullable(input.phone),
        dueDate: nullable(input.dueDate),
        tentativeNotifiedAt: bookingStatus === "TENTATIVE" ? now : null,
        tentativeDeadlineAt: bookingStatus === "TENTATIVE" ? tentativeDeadline : null,
        timeSlots: {
          create: slots.map((slot) => ({
            startTime: new Date(slot.start),
            endTime: new Date(slot.end),
            status: bookingStatus,
          })),
        },
      },
      include: { timeSlots: true },
    })

    const bookingEmailArgs = createBookingEmailArgs(input, userEmail)
    const emailTasks: Promise<unknown>[] = []
    if (bookingStatus === "TENTATIVE") {
      emailTasks.push(warnOnEmailFailure(sendBookingTentativeEmail(bookingEmailArgs), "tentative", userEmail))
    } else {
      emailTasks.push(warnOnEmailFailure(sendBookingConfirmedEmail(bookingEmailArgs), "confirmed", userEmail))
    }

    for (const tentativeConflict of tentativeConflicts) {
      const conflictEmail = tentativeConflict.customer.user.email
      if (!conflictEmail) {
        console.warn(`[email skipped] tag=overwrite to=missing bookingId=${tentativeConflict.id}`)
        continue
      }
      emailTasks.push(
        warnOnEmailFailure(
          sendBookingOverwriteNoticeEmail({
            to: conflictEmail,
            projectTitle: tentativeConflict.title,
            start: tentativeConflict.startTime,
            end: tentativeConflict.endTime,
            workScopes: [],
            otherWorkDetail: tentativeConflict.memo ?? "",
            estimatedDuration: "consult",
            deadline: tentativeDeadline,
          }),
          "overwrite",
          conflictEmail,
        ),
      )
    }
    await Promise.all(emailTasks)

    if (!calendarId) {
      console.warn("Booking created without Google Calendar event: GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set")
      return NextResponse.json(
        {
          status: "ok_with_warning",
          bookingGroupId: bookingGroup.id,
          bookingIds: bookingGroup.timeSlots.map((slot) => slot.id),
          bookingStatus,
          gcalError: "GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set",
        },
        { status: 207 },
      )
    }

    try {
      const accessToken = await refreshStoredCalendarToken()
      const description = createDescription(input)
      const event = await createCalendarEvent({
        calendarId,
        summary: createSummary(input),
        description,
        start: primarySlot.start,
        end: primarySlot.end,
        colorId: input.bookingKind === "tentative" ? "4" : "9",
        accessToken,
      })

      await prisma.bookingGroup.update({
        where: { id: bookingGroup.id },
        data: {
          gcalEventId: event.id,
        },
      })

      await Promise.all(
        tentativeConflicts
          .filter((conflictBooking) => conflictBooking.gcalEventId)
          .map((conflictBooking) =>
            updateCalendarEvent({
              calendarId,
              eventId: conflictBooking.gcalEventId!,
              summary: `【仮キープ→上書き予告】${conflictBooking.title} / ${conflictBooking.customer.displayName}`,
              description: conflictBooking.memo ?? "",
              start: conflictBooking.startTime.toISOString(),
              end: conflictBooking.endTime.toISOString(),
              colorId: "5",
              accessToken,
            }),
          ),
      )

      return NextResponse.json({
        status: "ok",
        bookingGroupId: bookingGroup.id,
        bookingIds: bookingGroup.timeSlots.map((slot) => slot.id),
        bookingStatus,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Calendar event write failed"
      console.warn("Booking created but Google Calendar write failed", {
        bookingGroupId: bookingGroup.id,
        error: message,
      })
      return NextResponse.json(
        {
          status: "ok_with_warning",
          bookingGroupId: bookingGroup.id,
          bookingIds: bookingGroup.timeSlots.map((slot) => slot.id),
          bookingStatus,
          gcalError: message,
        },
        { status: 207 },
      )
    }
  } catch (error) {
    console.error("Booking API failed", error)
    return NextResponse.json({ error: "unknown" }, { status: 500 })
  }
}
