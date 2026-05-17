import { prisma } from "@/lib/prisma"

export type BookingAccessScope = "owner" | "team" | "admin"

export type EditableBookingDetails = {
  projectTitle: string
  contactName: string
  contactEmail: string | null
  phone: string | null
  companyName: string | null
  memo: string | null
  dueDate: string | null
  teamId: string | null
  customerUserId: string
  status: string
}

export type EditableBookingTimeSlot = {
  id: string
  startTime: string
  endTime: string
  status: string
}

export type AccessibleBooking = {
  bookingId: string
  bookingGroupId: string
  scope: BookingAccessScope
  gcalEventId: string | null
  details: EditableBookingDetails
  timeSlots: EditableBookingTimeSlot[]
}

export async function findAccessibleSlot(
  slotId: string,
  userId: string,
  isAdmin: boolean,
): Promise<AccessibleBooking | null> {
  const slot = await prisma.bookingTimeSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      bookingGroupId: true,
      bookingGroup: {
        select: {
          id: true,
          projectTitle: true,
          contactName: true,
          contactEmail: true,
          phone: true,
          companyName: true,
          memo: true,
          dueDate: true,
          teamId: true,
          status: true,
          gcalEventId: true,
          customer: {
            select: {
              userId: true,
            },
          },
          team: {
            select: {
              members: {
                select: {
                  userId: true,
                },
              },
            },
          },
          timeSlots: {
            orderBy: { startTime: "asc" },
            select: {
              id: true,
              startTime: true,
              endTime: true,
              status: true,
            },
          },
        },
      },
    },
  })

  if (!slot) return null

  const customerUserId = slot.bookingGroup.customer.userId
  const isOwner = customerUserId === userId
  const isTeamMember = slot.bookingGroup.team?.members.some((member) => member.userId === userId) ?? false
  const scope: BookingAccessScope | null = isAdmin ? "admin" : isOwner ? "owner" : isTeamMember ? "team" : null
  if (!scope) return null

  return {
    bookingId: slot.id,
    bookingGroupId: slot.bookingGroupId,
    scope,
    gcalEventId: slot.bookingGroup.gcalEventId,
    details: {
      projectTitle: slot.bookingGroup.projectTitle,
      contactName: slot.bookingGroup.contactName,
      contactEmail: slot.bookingGroup.contactEmail,
      phone: slot.bookingGroup.phone,
      companyName: slot.bookingGroup.companyName,
      memo: slot.bookingGroup.memo,
      dueDate: slot.bookingGroup.dueDate,
      teamId: slot.bookingGroup.teamId,
      customerUserId,
      status: slot.bookingGroup.status,
    },
    timeSlots: slot.bookingGroup.timeSlots.map((timeSlot) => ({
      id: timeSlot.id,
      startTime: timeSlot.startTime.toISOString(),
      endTime: timeSlot.endTime.toISOString(),
      status: timeSlot.status,
    })),
  }
}
