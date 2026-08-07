// 2026-08-07: Booking Order の終端（控えメール・本人通知・カレンダー登録・Slack）を本番で
// 検証するために作った仮キープ 1 件を片付ける。検証は完了し、実案件ではないので残さない。
// 対象は下の 1 件だけを id 指定で消し、他の予約には触れない。
// 既定は dry-run。実行するときだけ APPLY=1 を付ける。

import { config as loadDotenv } from "dotenv"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env.production.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

const BOOKING_GROUP_ID = "cmsi50gol000204jtiy8z1oew"
const EXPECTED_TITLE_MARKER = "【動作テスト】"

async function main() {
  const apply = process.env.APPLY === "1"
  const { prisma } = await import("../../src/lib/prisma")

  try {
    const group = await prisma.bookingGroup.findUnique({
      where: { id: BOOKING_GROUP_ID },
      include: { timeSlots: true },
    })

    if (!group) {
      console.log(`booking group ${BOOKING_GROUP_ID} not found; nothing to remove`)
      return
    }

    // Refuse to touch anything that is not the verification booking.
    if (!group.projectTitle.includes(EXPECTED_TITLE_MARKER)) {
      throw new Error(
        `refusing to delete: projectTitle ${JSON.stringify(group.projectTitle)} does not contain ${EXPECTED_TITLE_MARKER}`,
      )
    }

    console.log("target:", {
      id: group.id,
      projectTitle: group.projectTitle,
      contactName: group.contactName,
      timeSlots: group.timeSlots.length,
      gcalEventId: group.gcalEventId,
    })

    if (!apply) {
      console.log("dry-run; re-run with APPLY=1 to remove")
      return
    }

    // The calendar OAuth credentials only exist server-side, so a local run cannot remove the
    // event. Report it instead of failing, and never leave the booking row behind because of it.
    if (group.gcalEventId) {
      try {
        const { deleteCalendarEvent } = await import("../../src/lib/google-calendar/server")
        await deleteCalendarEvent(group.gcalEventId)
        console.log("calendar event deleted:", group.gcalEventId)
      } catch (error) {
        console.warn(
          `calendar event NOT deleted (${group.gcalEventId}); remove it by hand:`,
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    await prisma.bookingGroup.delete({ where: { id: group.id } })
    console.log("booking group deleted:", group.id)
  } finally {
    await (await import("../../src/lib/prisma")).prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
