import { notFound } from "next/navigation"

import { auth } from "@/auth"
import { BookingEditForm } from "@/components/booking/booking-edit-form"
import { findAccessibleSlot } from "@/lib/booking/server/edit-access"

export const dynamic = "force-dynamic"

export default async function BookingEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()

  const adminEmail = process.env.BOOKING_CALENDAR_ADMIN_EMAIL
  const isCalendarAdmin = Boolean(adminEmail && session?.user?.email === adminEmail)
  const { id } = await params
  const booking = await findAccessibleSlot(id, userId, isCalendarAdmin)
  if (!booking) notFound()

  const currentSlot = booking.timeSlots.find((slot) => slot.id === booking.bookingId)
  const isPast = currentSlot ? Date.now() > new Date(currentSlot.startTime).getTime() : false

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 md:px-8 xl:px-12 py-12 md:py-16">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">Booking</p>
          <h1 className="mt-2 text-3xl font-bold text-hp md:text-4xl">予約編集</h1>
        </div>
        <div className="mt-8">
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
