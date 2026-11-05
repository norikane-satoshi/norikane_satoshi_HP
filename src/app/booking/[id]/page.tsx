import { notFound } from "next/navigation"

import { auth } from "@/auth"
import { BookingEditForm } from "@/components/booking/booking-edit-form"
import { isAdmin } from "@/lib/auth/server/is-admin"
import { findAccessibleSlot } from "@/lib/booking/server/edit-access"

export const dynamic = "force-dynamic"

function isBookingSlotPast(startTime: string): boolean {
  return Date.now() > new Date(startTime).getTime()
}

export default async function BookingEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()

  const isCalendarAdmin = isAdmin(session?.user?.email)
  const { id } = await params
  const booking = await findAccessibleSlot(id, userId, isCalendarAdmin)
  if (!booking) notFound()

  const currentSlot = booking.timeSlots.find((slot) => slot.id === booking.bookingId)
  const isPast = currentSlot ? isBookingSlotPast(currentSlot.startTime) : false

  return (
    <section data-hp-theme="noir" className="hp-section-shell py-12 md:py-16">
      <div>
        <div className="hp-section-heading-row">
          <h1 className="hp-heading text-3xl font-medium text-hp md:text-4xl xl:text-5xl">予約編集</h1>
        </div>
        <div className="mt-10">
          <BookingEditForm
            bookingId={booking.bookingId}
            bookingGroupId={booking.bookingGroupId}
            initialDetails={booking.details}
            initialTimeSlots={booking.timeSlots}
            scope={booking.scope}
            isCalendarAdmin={isCalendarAdmin}
            isPast={isPast}
          />
        </div>
      </div>
    </section>
  )
}
