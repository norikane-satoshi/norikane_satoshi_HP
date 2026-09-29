import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { createClient } from "@libsql/client"
import { afterAll, beforeAll, expect, it, vi } from "vitest"

const directory = mkdtempSync(join(tmpdir(), "hp-claim-test-"))
const url = `file:${join(directory, "test.db")}`
const db = new PrismaClient({ adapter: new PrismaLibSql({ url }) })
beforeAll(async () => {
  const schema = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const sql = createClient({ url })
  await sql.executeMultiple(schema)
  sql.close()
  vi.doMock("@/lib/prisma", () => ({ prisma: db }))
})
afterAll(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); vi.doUnmock("@/lib/prisma") })

it("claims only verified anonymous chat bookings and never reassigns ownership on repeat", async () => {
  const { claimChatBookingsForVerifiedUser } = await import("@/lib/booking/server/claim-chat-bookings")
  const anonymous = await db.user.create({ data: { email: "chatbot-booking@norikane.studio", customer: { create: { displayName: "Anonymous" } } }, include: { customer: true } })
  const owner = await db.user.create({ data: { email: "owner@example.com" } })
  const other = await db.user.create({ data: { email: "other@example.com", emailVerified: new Date(), customer: { create: { displayName: "Other" } } }, include: { customer: true } })
  const make = (email: string, customerId: string, originatedFrom = "chatbot") => db.bookingGroup.create({ data: { customerId, originatedFrom, customerEmail: email, projectTitle: "Test", contactName: "Test" } })
  const mine = await make(" Owner@EXAMPLE.com ", anonymous.customer!.id)
  const theirs = await make("other@example.com", anonymous.customer!.id)
  const alreadyOwned = await make("owner@example.com", other.customer!.id)
  const nonChat = await make("owner@example.com", anonymous.customer!.id, "web")
  await claimChatBookingsForVerifiedUser(owner.id)
  expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: mine.id } })).customerId).toBe(anonymous.customer!.id)
  const { markVerifiedGoogleEmail } = await import("@/lib/auth/server/verified-google-email")
  await markVerifiedGoogleEmail({ user: owner,
    account: { provider: "google", providerAccountId: "google-owner", type: "oidc" },
    profile: { email: owner.email!, email_verified: true },
  })
  const verifiedAt = (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).emailVerified
  expect(verifiedAt).toBeInstanceOf(Date)
  await markVerifiedGoogleEmail({ user: owner,
    account: { provider: "google", providerAccountId: "google-owner", type: "oidc" },
    profile: { email: owner.email!, email_verified: true },
  })
  expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).emailVerified).toEqual(verifiedAt)
  await claimChatBookingsForVerifiedUser(owner.id)
  await claimChatBookingsForVerifiedUser(owner.id)
  const customer = await db.customer.findUniqueOrThrow({ where: { userId: owner.id } })
  expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: mine.id } })).customerId).toBe(customer.id)
  expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: theirs.id } })).customerId).toBe(anonymous.customer!.id)
  expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: alreadyOwned.id } })).customerId).toBe(other.customer!.id)
  expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: nonChat.id } })).customerId).toBe(anonymous.customer!.id)
  const second = await db.user.create({ data: { email: "OWNER@example.com", emailVerified: new Date() } })
  await claimChatBookingsForVerifiedUser(second.id)
  expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: mine.id } })).customerId).toBe(customer.id)
})

it("retains panel provenance atomically when an edited request is interrupted", async () => {
  const { coordinateChatbotMessageRequest, replaceChatbotMessageRequestUserMessage } = await import("@/lib/chatbot/server/message-request-coordinator")
  const choice = { choiceSet: { id: "attendance-days", question: "何日？", choices: [{ id: "2", label: "2日" }] }, selectedIds: ["2"], selectedLabels: ["2日"] }
  const conversation = await db.chatbotConversation.create({ data: {
    sessionId: "sqlite-edit-session", conversationState: JSON.stringify({ hasAttendanceDays: true, choiceAnswers: { original: choice, later: choice } }),
    messages: { create: [
      { id: "original", role: "user", content: "選択: 2日", createdAt: new Date("2026-01-01T00:00:00Z") },
      { id: "later", role: "user", content: "後続", createdAt: new Date("2026-01-01T00:00:01Z") },
    ] },
  } })
  const requestKey = `client_msg_${crypto.randomUUID()}`
  await expect(coordinateChatbotMessageRequest({ sessionId: conversation.sessionId, requestId: crypto.randomUUID(), requestKey, payloadHash: "edit", execute: async (ownership) => {
    await replaceChatbotMessageRequestUserMessage({ ownership: ownership!, targetMessageId: "original", content: "選択: 2日" })
    throw new Error("simulated interruption")
  } })).rejects.toThrow("simulated interruption")
  const stored = await db.chatbotConversation.findUniqueOrThrow({ where: { id: conversation.id } })
  expect(JSON.parse(stored.conversationState!)).toEqual({ choiceAnswers: { [requestKey]: choice } })
})
