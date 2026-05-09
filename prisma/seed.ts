import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: process.env.TURSO_DATABASE_URL ?? process.env.PRISMA_MIGRATE_DATABASE_URL ?? "file:./dev.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
})

async function main() {
  if (process.env.NODE_ENV === "production") return

  const user = await prisma.user.upsert({
    where: { email: "customer-test@dummy.local" },
    update: {
      name: "テスト予約者",
    },
    create: {
      email: "customer-test@dummy.local",
      name: "テスト予約者",
      emailVerified: new Date(),
    },
  })

  const customer = await prisma.customer.upsert({
    where: { userId: user.id },
    update: {
      displayName: "テスト予約者",
      companyName: "ダミー会社",
    },
    create: {
      userId: user.id,
      displayName: "テスト予約者",
      companyName: "ダミー会社",
    },
  })

  const now = new Date()
  await prisma.bookingGroup.upsert({
    where: { id: "seed-may-2026-tentative" },
    update: {
      customerId: customer.id,
      kind: "TENTATIVE",
      status: "TENTATIVE",
      projectTitle: "【ダミー】仮キープ動作確認",
      contactName: "テスト予約者",
      companyName: "ダミー会社",
      tentativeNotifiedAt: now,
      tentativeDeadlineAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    },
    create: {
      id: "seed-may-2026-tentative",
      customerId: customer.id,
      kind: "TENTATIVE",
      status: "TENTATIVE",
      projectTitle: "【ダミー】仮キープ動作確認",
      contactName: "テスト予約者",
      companyName: "ダミー会社",
      tentativeNotifiedAt: now,
      tentativeDeadlineAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      timeSlots: {
        create: {
          id: "seed-slot-2026-05-15-14",
          startTime: new Date("2026-05-15T14:00:00+09:00"),
          endTime: new Date("2026-05-15T16:00:00+09:00"),
          status: "TENTATIVE",
        },
      },
    },
  })

  await prisma.bookingTimeSlot.upsert({
    where: { id: "seed-slot-2026-05-15-14" },
    update: {
      bookingGroupId: "seed-may-2026-tentative",
      startTime: new Date("2026-05-15T14:00:00+09:00"),
      endTime: new Date("2026-05-15T16:00:00+09:00"),
      status: "TENTATIVE",
    },
    create: {
      id: "seed-slot-2026-05-15-14",
      bookingGroupId: "seed-may-2026-tentative",
      startTime: new Date("2026-05-15T14:00:00+09:00"),
      endTime: new Date("2026-05-15T16:00:00+09:00"),
      status: "TENTATIVE",
    },
  })
}

main()
  .finally(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
