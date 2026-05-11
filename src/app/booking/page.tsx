import { auth } from "@/auth"
import { BookingSection } from "@/components/booking/booking-section"
import { redirect } from "next/navigation"

export default async function BookingPage() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/booking")

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 md:px-8 xl:px-12 py-12 md:py-16">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
          Booking
        </p>
        <h1 className="mt-2 text-4xl font-bold text-hp md:text-5xl xl:text-6xl">
          予約カレンダー
        </h1>
        <div className="mt-8">
          <BookingSection userId={session.user.id} userEmail={session.user.email ?? ""} />
        </div>
      </div>
    </section>
  )
}
