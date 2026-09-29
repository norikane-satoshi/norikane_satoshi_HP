import { prisma } from "@/lib/prisma"

export const PUBLIC_CHATBOT_BOOKING_USER_EMAIL = "chatbot-booking@norikane.studio"

/** Claim only anonymous chat submissions; never transfer another customer's bookings. */
export async function claimChatBookingsForVerifiedUser(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true, name: true },
    })
    if (!user?.emailVerified || !user.email) return
    const email = user.email.trim().toLowerCase()
    if (email === PUBLIC_CHATBOT_BOOKING_USER_EMAIL) return

    const anonymous = await tx.customer.findFirst({
      where: { user: { email: PUBLIC_CHATBOT_BOOKING_USER_EMAIL } },
      select: { id: true },
    })
    if (!anonymous) return
    const candidates = await tx.bookingGroup.findMany({
      where: { customerId: anonymous.id, originatedFrom: "chatbot", teamId: null },
      select: { id: true, customerEmail: true },
    })
    const ids = candidates
      .filter((row) => row.customerEmail?.trim().toLowerCase() === email)
      .map((row) => row.id)
    if (ids.length === 0) return

    const customer = await tx.customer.upsert({
      where: { userId },
      update: {},
      create: { userId, displayName: user.name ?? user.email },
      select: { id: true },
    })
    // Recheck ownership in the write itself, including when concurrent claims race.
    await tx.bookingGroup.updateMany({
      where: { id: { in: ids }, customerId: anonymous.id, originatedFrom: "chatbot", teamId: null },
      data: { customerId: customer.id },
    })
  })
}
