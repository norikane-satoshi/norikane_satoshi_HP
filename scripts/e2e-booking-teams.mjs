import { PrismaLibSql } from "@prisma/adapter-libsql"
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"
import { encode } from "next-auth/jwt"

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:41239"
const baseHost = new URL(baseUrl).hostname
const dbUrl = process.env.TURSO_DATABASE_URL
const authSecret = process.env.AUTH_SECRET
const cookieName = "authjs.session-token"
const prefix = `team-e2e-${Date.now()}`

if (!dbUrl) throw new Error("TURSO_DATABASE_URL is required")
if (!authSecret) throw new Error("AUTH_SECRET is required")

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN }),
})

async function createUser(label) {
  return prisma.user.create({
    data: {
      email: `${prefix}-${label}@example.com`,
      name: `E2E ${label}`,
      emailVerified: new Date(),
    },
  })
}

async function createBooking(user, label, start, end) {
  const customer = await prisma.customer.create({
    data: {
      userId: user.id,
      displayName: user.name ?? label,
    },
  })

  return prisma.bookingGroup.create({
    data: {
      customerId: customer.id,
      status: "CONFIRMED",
      projectTitle: `${prefix} ${label}`,
      contactName: user.name ?? label,
      contactEmail: user.email,
      timeSlots: {
        create: {
          startTime: new Date(start),
          endTime: new Date(end),
          status: "CONFIRMED",
        },
      },
    },
    include: { timeSlots: true },
  })
}

async function tokenFor(user) {
  return encode({
    token: {
      sub: user.id,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
    },
    secret: authSecret,
    salt: cookieName,
    maxAge: 60 * 60,
  })
}

async function api(path, token, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie: `${cookieName}=${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  return { response, json }
}

async function listBookings(token, teamId = null) {
  const params = new URLSearchParams({
    start: "2026-06-01T00:00:00.000Z",
    end: "2026-06-30T00:00:00.000Z",
  })
  if (teamId) params.set("teamId", teamId)
  const { json } = await api(`/api/calendar/free-busy?${params.toString()}`, token)
  return json.bookings ?? []
}

function hasBooking(bookings, bookingGroupId) {
  return bookings.some((booking) => booking.bookingGroupId === bookingGroupId)
}

async function main() {
  const userA = await createUser("a")
  const userB = await createUser("b")
  const tokenA = await tokenFor(userA)
  const tokenB = await tokenFor(userB)

  const bookingA = await createBooking(userA, "A personal", "2026-06-10T01:00:00.000Z", "2026-06-10T02:00:00.000Z")
  const bookingB = await createBooking(userB, "B personal", "2026-06-11T01:00:00.000Z", "2026-06-11T02:00:00.000Z")

  const personalA = await listBookings(tokenA)
  const a = hasBooking(personalA, bookingA.id) && !hasBooking(personalA, bookingB.id)

  const created = await api("/api/teams", tokenA, {
    method: "POST",
    body: JSON.stringify({ name: `${prefix} channel` }),
  })
  if (!created.response.ok) throw new Error(`team create failed: ${created.response.status}`)
  const teamId = created.json.teamId

  const invite = await api("/api/team-invitations", tokenA, {
    method: "POST",
    body: JSON.stringify({ teamId }),
  })
  if (!invite.response.ok) throw new Error(`invite create failed: ${invite.response.status}`)

  const accepted = await fetch(invite.json.url, {
    headers: { cookie: `${cookieName}=${tokenB}` },
    redirect: "manual",
  })
  const acceptedLocation = accepted.headers.get("location") ?? ""

  const teamBookingsBeforeLeave = await listBookings(tokenA, teamId)
  const b = acceptedLocation.includes("invite=accepted")
    && hasBooking(teamBookingsBeforeLeave, bookingA.id)
    && hasBooking(teamBookingsBeforeLeave, bookingB.id)

  const secondAccept = await fetch(invite.json.url, {
    headers: { cookie: `${cookieName}=${tokenA}` },
    redirect: "manual",
  })
  const secondAcceptLocation = secondAccept.headers.get("location") ?? ""
  const d = secondAcceptLocation.includes("invite=used")

  const left = await api(`/api/teams/${teamId}/membership`, tokenB, { method: "DELETE" })
  if (!left.response.ok) throw new Error(`team leave failed: ${left.response.status}`)

  const teamBookingsAfterLeave = await listBookings(tokenA, teamId)
  const personalBAfterLeave = await listBookings(tokenB)
  const c = hasBooking(teamBookingsAfterLeave, bookingA.id)
    && !hasBooking(teamBookingsAfterLeave, bookingB.id)
    && hasBooking(personalBAfterLeave, bookingB.id)

  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addCookies([
    {
      name: cookieName,
      value: tokenA,
      domain: baseHost,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ])
  const page = await context.newPage()
  await page.goto(`${baseUrl}/booking/settings`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "削除" }).click()
  const modalVisible = await page.getByText("削除すると(1) チャンネルは消える(2) チャンネル表示からメンバーの案件は消える(3) ただし各自の個人履歴には案件が残る").isVisible()
  await page.getByRole("button", { name: "削除する" }).click()
  await page.getByText("チャンネルを削除しました。").waitFor()
  await browser.close()

  const teamsAfterDelete = await api("/api/teams", tokenA)
  const personalAAfterDelete = await listBookings(tokenA)
  const e = modalVisible
    && !((teamsAfterDelete.json.teams ?? []).some((team) => team.id === teamId))
    && hasBooking(personalAAfterDelete, bookingA.id)

  const result = { a, b, c, d, e }
  console.log(JSON.stringify(result, null, 2))

  if (!Object.values(result).every(Boolean)) {
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
