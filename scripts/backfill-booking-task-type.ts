// 既存の本予約 (BookingGroup.status = "CONFIRMED" かつ notionPageId 未付与) に対して、
// IB_仕事 ページを「タスク種別: スケジュール」付きで作成または更新し、notionPageId を保存する。
//
// 動作:
//   1. notionPageId が NULL の CONFIRMED な BookingGroup を全件抽出
//   2. 各レコードについて gcalEventId があれば IB_仕事 を gcal_event_id 一致で検索
//      - ヒット: 既存ページに「タスク種別: スケジュール」をセットして notionPageId を保存
//      - 未ヒット or gcalEventId 無し: 新規ページを作成
//   3. 件数を集計して JSON で stdout 出力
//
// 起動例（リポジトリ直下）:
//   tsx scripts/backfill-booking-task-type.ts
//
// 既存の Notion ページを上書きする副作用があるため、本番投入前に dev DB で結果を確認する想定。

import { PrismaLibSql } from "@prisma/adapter-libsql"
import { PrismaClient } from "@prisma/client"
import { config as loadDotenv } from "dotenv"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

import {
  createBookingTaskPage,
  findIbWorkPageByGcalEventId,
  setTaskTypeSchedule,
} from "../src/lib/notion/booking-task"

type Booking = {
  id: string
  projectTitle: string
  contactName: string
  memo: string | null
  contactEmail: string | null
  phone: string | null
  companyName: string | null
  dueDate: string | null
  gcalEventId: string | null
  notionPageId: string | null
  customer: {
    user: {
      email: string | null
    }
  }
  timeSlots: { startTime: Date; endTime: Date }[]
}

function createPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaLibSql({
      url: process.env.TURSO_DATABASE_URL ?? "file:./dev.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
  })
}

function buildSummary(booking: Booking): string {
  return `【予約確定】${booking.projectTitle} / ${booking.contactName}`
}

function buildDescription(booking: Booking): string {
  return [
    ["案件名", booking.projectTitle],
    ["納期", booking.dueDate ?? ""],
    ["会社名", booking.companyName ?? ""],
    ["担当者氏名", booking.contactName],
    ["メールアドレス", booking.customer.user.email ?? ""],
    ["連絡用メール", booking.contactEmail ?? ""],
    ["電話番号", booking.phone ?? ""],
    ["補足メモ", booking.memo ?? ""],
  ]
    .map(([label, value]) => `${label}: ${value.trim() || "-"}`)
    .join("\n")
}

async function main(): Promise<void> {
  const prisma = createPrisma()
  const summary = {
    scanned: 0,
    skippedNoSlot: 0,
    updatedExistingNotionPage: 0,
    createdNewNotionPage: 0,
    failed: 0,
    samples: [] as { bookingGroupId: string; notionPageId: string; action: "updated" | "created" }[],
  }

  try {
    const bookings = (await prisma.bookingGroup.findMany({
      where: {
        status: "CONFIRMED",
        notionPageId: null,
      },
      include: {
        customer: {
          include: { user: { select: { email: true } } },
        },
        timeSlots: {
          orderBy: { startTime: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    })) as unknown as Booking[]

    summary.scanned = bookings.length

    for (const booking of bookings) {
      const primarySlot = booking.timeSlots[0]
      if (!primarySlot) {
        summary.skippedNoSlot += 1
        continue
      }

      try {
        let pageId: string | null = null
        let action: "updated" | "created" = "created"

        if (booking.gcalEventId) {
          const existing = await findIbWorkPageByGcalEventId(booking.gcalEventId)
          if (existing) {
            await setTaskTypeSchedule(existing)
            pageId = existing
            action = "updated"
            summary.updatedExistingNotionPage += 1
          }
        }

        if (!pageId) {
          const result = await createBookingTaskPage({
            title: buildSummary(booking),
            start: primarySlot.startTime.toISOString(),
            end: primarySlot.endTime.toISOString(),
            gcalEventId: booking.gcalEventId,
            description: buildDescription(booking),
          })
          if (result.skipped) {
            console.warn(
              `[backfill skipped] bookingGroupId=${booking.id} reason=${result.reason}`,
            )
            summary.failed += 1
            continue
          }
          pageId = result.pageId
          summary.createdNewNotionPage += 1
        }

        await prisma.bookingGroup.update({
          where: { id: booking.id },
          data: { notionPageId: pageId },
        })

        if (summary.samples.length < 5) {
          summary.samples.push({
            bookingGroupId: booking.id,
            notionPageId: pageId,
            action,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[backfill failed] bookingGroupId=${booking.id} error=${message}`)
        summary.failed += 1
      }
    }

    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error(error)
  process.exit(1)
})
