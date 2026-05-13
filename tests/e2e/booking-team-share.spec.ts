import { expect, test, type APIRequestContext } from "@playwright/test"

import {
  createBookingForUser,
  prismaForE2E,
  sessionCookieFor,
  upsertUser,
} from "./booking-test-utils"

const prefix = `booking-team-${Date.now()}`

async function jsonRequest(
  request: APIRequestContext,
  method: "get" | "post" | "delete",
  path: string,
  cookie: string,
  body?: unknown,
) {
  const response = await request[method](path, {
    headers: {
      cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    data: body,
    maxRedirects: 0,
  })
  const text = await response.text()
  return { response, json: text ? JSON.parse(text) : {} }
}

function hasBooking(bookings: { bookingGroupId: string }[], bookingGroupId: string) {
  return bookings.some((booking) => booking.bookingGroupId === bookingGroupId)
}

test.describe("booking team share", () => {
  test("create channel, accept invite, aggregate member bookings, then leave without deleting personal history", async ({ request }) => {
    const prisma = prismaForE2E()
    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await prisma.team.deleteMany({ where: { name: { startsWith: prefix } } })

    const userA = await upsertUser(prisma, `${prefix}-a@example.com`, "Team A")
    const userB = await upsertUser(prisma, `${prefix}-b@example.com`, "Team B")
    const cookieA = await sessionCookieFor(userA)
    const cookieB = await sessionCookieFor(userB)
    const bookingA = await createBookingForUser(prisma, userA, {
      prefix,
      label: "A personal",
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
    })
    const bookingB = await createBookingForUser(prisma, userB, {
      prefix,
      label: "B personal",
      start: "2026-06-11T01:00:00.000Z",
      end: "2026-06-11T02:00:00.000Z",
    })

    const created = await jsonRequest(request, "post", "/api/teams", cookieA, { name: `${prefix} channel` })
    expect(created.response.status()).toBe(201)
    const teamId = created.json.teamId as string

    const invited = await jsonRequest(request, "post", "/api/team-invitations", cookieA, { teamId })
    expect(invited.response.status()).toBe(200)
    const accepted = await request.get(invited.json.url as string, {
      headers: { cookie: cookieB },
      maxRedirects: 0,
    })
    expect(accepted.status()).toBe(307)
    expect(accepted.headers().location).toContain("invite=accepted")

    const teamBeforeLeave = await jsonRequest(
      request,
      "get",
      `/api/calendar/free-busy?start=2026-06-01T00:00:00.000Z&end=2026-06-30T00:00:00.000Z&teamId=${teamId}`,
      cookieA,
    )
    expect(teamBeforeLeave.response.status()).toBe(200)
    expect(hasBooking(teamBeforeLeave.json.bookings, bookingA.id)).toBe(true)
    expect(hasBooking(teamBeforeLeave.json.bookings, bookingB.id)).toBe(true)

    const left = await jsonRequest(request, "delete", `/api/teams/${teamId}/membership`, cookieB)
    expect(left.response.status()).toBe(200)

    const teamAfterLeave = await jsonRequest(
      request,
      "get",
      `/api/calendar/free-busy?start=2026-06-01T00:00:00.000Z&end=2026-06-30T00:00:00.000Z&teamId=${teamId}`,
      cookieA,
    )
    expect(teamAfterLeave.response.status()).toBe(200)
    expect(hasBooking(teamAfterLeave.json.bookings, bookingA.id)).toBe(true)
    expect(hasBooking(teamAfterLeave.json.bookings, bookingB.id)).toBe(false)

    const personalB = await jsonRequest(
      request,
      "get",
      "/api/calendar/free-busy?start=2026-06-01T00:00:00.000Z&end=2026-06-30T00:00:00.000Z",
      cookieB,
    )
    expect(personalB.response.status()).toBe(200)
    expect(hasBooking(personalB.json.bookings, bookingB.id)).toBe(true)

    await prisma.team.deleteMany({ where: { name: { startsWith: prefix } } })
    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { email: { in: [userA.email, userB.email].filter((email): email is string => Boolean(email)) } } })
    await prisma.$disconnect()
  })
})
