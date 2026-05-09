PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "BookingGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "projectTitle" TEXT NOT NULL,
    "memo" TEXT,
    "contactName" TEXT NOT NULL,
    "companyName" TEXT,
    "contactEmail" TEXT,
    "phone" TEXT,
    "dueDate" TEXT,
    "tentativeNotifiedAt" DATETIME,
    "tentativeDeadlineAt" DATETIME,
    "gcalEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingGroup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BookingTimeSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingGroupId" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingTimeSlot_bookingGroupId_fkey" FOREIGN KEY ("bookingGroupId") REFERENCES "BookingGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "BookingGroup" (
    "id",
    "customerId",
    "kind",
    "status",
    "projectTitle",
    "memo",
    "contactName",
    "companyName",
    "phone",
    "tentativeNotifiedAt",
    "tentativeDeadlineAt",
    "gcalEventId",
    "createdAt",
    "updatedAt"
)
SELECT
    "Booking"."id",
    "Booking"."customerId",
    CASE
        WHEN "Booking"."status" IN ('TENTATIVE', 'PENDING_CONFIRMATION') THEN 'TENTATIVE'
        ELSE 'CONFIRMED'
    END,
    "Booking"."status",
    "Booking"."title",
    "Booking"."memo",
    COALESCE("Customer"."displayName", '予約者'),
    "Customer"."companyName",
    "Customer"."phone",
    "Booking"."tentativeNotifiedAt",
    "Booking"."tentativeDeadlineAt",
    "Booking"."gcalEventId",
    "Booking"."createdAt",
    "Booking"."updatedAt"
FROM "Booking"
JOIN "Customer" ON "Customer"."id" = "Booking"."customerId";

INSERT INTO "BookingTimeSlot" (
    "id",
    "bookingGroupId",
    "startTime",
    "endTime",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    "Booking"."id" || '-slot',
    "Booking"."id",
    "Booking"."startTime",
    "Booking"."endTime",
    "Booking"."status",
    "Booking"."createdAt",
    "Booking"."updatedAt"
FROM "Booking";

DROP TABLE "Booking";

CREATE INDEX "BookingGroup_status_idx" ON "BookingGroup"("status");
CREATE INDEX "BookingGroup_kind_idx" ON "BookingGroup"("kind");
CREATE INDEX "BookingTimeSlot_startTime_endTime_idx" ON "BookingTimeSlot"("startTime", "endTime");
CREATE INDEX "BookingTimeSlot_status_idx" ON "BookingTimeSlot"("status");
CREATE INDEX "BookingTimeSlot_bookingGroupId_idx" ON "BookingTimeSlot"("bookingGroupId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
