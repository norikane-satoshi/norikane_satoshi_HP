export type CalendarBookingFromApi = {
  id: string
  bookingGroupId: string
  customerUserId: string
  start: string
  end: string
  title: string
  status: string
}

async function listBookingsWithWhere(
  timeMin: string,
  timeMax: string,
  bookingGroupWhere: {
    customer?: {
      userId: { in: string[] }
    }
  },
): Promise<CalendarBookingFromApi[]> {
  const { prisma } = await import("@/lib/prisma")
  const startDate = new Date(timeMin)
  const endDate = new Date(timeMax)
  const dbBookings = await prisma.bookingTimeSlot.findMany({
    where: {
      startTime: { lt: endDate },
      endTime: { gt: startDate },
      status: "CONFIRMED",
      bookingGroup: bookingGroupWhere,
    },
    select: {
      id: true,
      bookingGroupId: true,
      startTime: true,
      endTime: true,
      status: true,
      bookingGroup: {
        select: {
          projectTitle: true,
          status: true,
          customer: {
            select: {
              userId: true,
            },
          },
        },
      },
    },
  })

  return dbBookings.map((booking) => ({
    id: booking.id,
    bookingGroupId: booking.bookingGroupId,
    customerUserId: booking.bookingGroup.customer.userId,
    start: booking.startTime.toISOString(),
    end: booking.endTime.toISOString(),
    title: booking.bookingGroup.projectTitle,
    status: booking.bookingGroup.status,
  }))
}

export async function listBookings(
  timeMin: string,
  timeMax: string,
  userIds: string[],
): Promise<CalendarBookingFromApi[]> {
  return listBookingsWithWhere(timeMin, timeMax, {
    customer: {
      userId: { in: userIds },
    },
  })
}

export async function listAllBookings(
  timeMin: string,
  timeMax: string,
): Promise<CalendarBookingFromApi[]> {
  return listBookingsWithWhere(timeMin, timeMax, {})
}
