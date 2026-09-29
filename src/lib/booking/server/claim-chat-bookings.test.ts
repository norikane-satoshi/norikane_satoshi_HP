import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  customer: { findFirst: vi.fn(), upsert: vi.fn() },
  bookingGroup: { findMany: vi.fn(), updateMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } }))
import { claimChatBookingsForVerifiedUser } from "./claim-chat-bookings"

describe("claimChatBookingsForVerifiedUser", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.user.findUnique.mockResolvedValue({ email: "Owner@example.com", emailVerified: new Date(), name: "Owner" })
    tx.customer.findFirst.mockResolvedValue({ id: "anonymous" })
    tx.customer.upsert.mockResolvedValue({ id: "owner" })
    tx.bookingGroup.findMany.mockResolvedValue([
      { id: "mine", customerEmail: " owner@EXAMPLE.com " },
      { id: "other", customerEmail: "other@example.com" },
      { id: "missing", customerEmail: null },
    ])
  })
  it("claims only matching anonymous chat records with an ownership guard", async () => {
    await claimChatBookingsForVerifiedUser("user")
    expect(tx.bookingGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: "anonymous", originatedFrom: "chatbot", teamId: null },
    }))
    expect(tx.bookingGroup.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["mine"] }, customerId: "anonymous", originatedFrom: "chatbot", teamId: null },
      data: { customerId: "owner" },
    })
  })
  it.each([null, { email: "owner@example.com", emailVerified: null },
    { email: null, emailVerified: new Date() },
    { email: "chatbot-booking@norikane.studio", emailVerified: new Date() },
  ])("does not claim for unverified, missing, or service users: %j", async (user) => {
    tx.user.findUnique.mockResolvedValue(user)
    await claimChatBookingsForVerifiedUser("user")
    expect(tx.customer.findFirst).not.toHaveBeenCalled()
    expect(tx.bookingGroup.updateMany).not.toHaveBeenCalled()
  })
  it("does nothing after records have already moved", async () => {
    tx.bookingGroup.findMany.mockResolvedValue([])
    await claimChatBookingsForVerifiedUser("user")
    expect(tx.customer.upsert).not.toHaveBeenCalled()
    expect(tx.bookingGroup.updateMany).not.toHaveBeenCalled()
  })
})
