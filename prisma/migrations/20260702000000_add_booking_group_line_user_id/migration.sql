ALTER TABLE "BookingGroup" ADD COLUMN "lineUserId" TEXT;

CREATE INDEX "BookingGroup_lineUserId_idx" ON "BookingGroup"("lineUserId");
