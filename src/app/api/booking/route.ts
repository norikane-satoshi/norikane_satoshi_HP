import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { bookingApiSchema, type BookingApiInput } from "@/lib/booking/api-schema"
import { invalidateCalendarFreeBusyCacheForUser } from "@/lib/booking/calendar-free-busy/free-busy"
import {
  findConflictingBookings,
  resolveConflictForFinalSubmit,
} from "@/lib/booking/conflicts"
import { isTeamMember } from "@/lib/booking/team-access"
import {
  sendBookingConfirmedEmail,
  type BookingEmailArgs,
} from "@/lib/booking/email"
import {
  CALENDAR_TOKEN_USER_ID,
  createCalendarEvent,
  refreshCalendarAccessToken,
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
  return `【予約確定】${input.projectTitle} / ${input.contactName}`
}

function createBookingEmailArgs(input: BookingApiInput, to: string): BookingEmailArgs {
  const slot = input.selectedSlots[0]
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

  const teamId = input.teamId ?? null
  if (teamId && !(await isTeamMember(userId, teamId))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const slots = input.selectedSlots
  const primarySlot = slots[0]
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
    const conflict = resolveConflictForFinalSubmit(conflicts)
    if (conflict) return responseForConflict(conflict)

    const bookingGroup = await prisma.bookingGroup.create({
      data: {
        customerId: customer.id,
        teamId,
        status: "CONFIRMED",
        projectTitle: input.projectTitle,
        memo: nullable(input.memo),
        contactName: input.contactName,
        companyName: nullable(input.companyName),
        contactEmail: nullable(input.contactEmail),
        phone: nullable(input.phone),
        dueDate: nullable(input.dueDate),
        timeSlots: {
          create: slots.map((slot) => ({
            startTime: new Date(slot.start),
            endTime: new Date(slot.end),
            status: "CONFIRMED",
          })),
        },
      },
      include: { timeSlots: true },
    })
    invalidateCalendarFreeBusyCacheForUser(userId, teamId)

    const bookingEmailArgs = createBookingEmailArgs(input, userEmail)
    await warnOnEmailFailure(
      sendBookingConfirmedEmail(bookingEmailArgs),
      "confirmed",
      userEmail,
    )

    if (!calendarId) {
      console.warn("Booking created without Google Calendar event: GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set")
      return NextResponse.json(
        {
          status: "ok_with_warning",
          bookingGroupId: bookingGroup.id,
          bookingIds: bookingGroup.timeSlots.map((slot) => slot.id),
          bookingStatus: "CONFIRMED",
          gcalError: "GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set",
        },
        { status: 207 },
      )
    }

    const description = createDescription(input)
    const summary = createSummary(input)
    let gcalEventId: string | null = null
    let gcalError: string | null = null
    try {
      const accessToken = await refreshStoredCalendarToken()
      const event = await createCalendarEvent({
        calendarId,
        summary,
        description,
        start: primarySlot.start,
        end: primarySlot.end,
        colorId: "9",
        accessToken,
      })
      gcalEventId = event.id ?? null

      await prisma.bookingGroup.update({
        where: { id: bookingGroup.id },
        data: { gcalEventId },
      })
    } catch (error) {
      gcalError = error instanceof Error ? error.message : "Google Calendar event write failed"
      console.warn("Booking created but Google Calendar write failed", {
        bookingGroupId: bookingGroup.id,
        error: gcalError,
      })
    }

    if (gcalError) {
      return NextResponse.json(
        {
          status: "ok_with_warning",
          bookingGroupId: bookingGroup.id,
          bookingIds: bookingGroup.timeSlots.map((slot) => slot.id),
          bookingStatus: "CONFIRMED",
          gcalError,
        },
        { status: 207 },
      )
    }

    return NextResponse.json({
      status: "ok",
      bookingGroupId: bookingGroup.id,
      bookingIds: bookingGroup.timeSlots.map((slot) => slot.id),
      bookingStatus: "CONFIRMED",
    })
  } catch (error) {
    console.error("Booking API failed", error)
    return NextResponse.json({ error: "unknown" }, { status: 500 })
  }
}
