-- AlterTable
ALTER TABLE "BookingGroup" ADD COLUMN "bufferAfterHours" REAL DEFAULT 1;
ALTER TABLE "BookingGroup" ADD COLUMN "bufferBeforeHours" REAL DEFAULT 1;
