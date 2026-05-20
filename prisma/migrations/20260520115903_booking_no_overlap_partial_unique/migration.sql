CREATE UNIQUE INDEX IF NOT EXISTS "idx_booking_no_overlap"
ON "BookingTimeSlot"("startTime", "endTime")
WHERE "status" IN ('PENDING_GCAL', 'CONFIRMED');
