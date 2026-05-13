PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- 仮キープ系の status を一律 CANCELLED に倒す（GCal 上書き削除は本予約フロー復帰時に手当）
UPDATE "BookingGroup"
SET "status" = 'CANCELLED'
WHERE "status" IN ('TENTATIVE', 'PENDING_CONFIRMATION', 'OVERWRITTEN');

UPDATE "BookingTimeSlot"
SET "status" = 'CANCELLED'
WHERE "status" IN ('TENTATIVE', 'PENDING_CONFIRMATION', 'OVERWRITTEN');

CREATE TABLE "BookingGroup_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "projectTitle" TEXT NOT NULL,
    "memo" TEXT,
    "contactName" TEXT NOT NULL,
    "companyName" TEXT,
    "contactEmail" TEXT,
    "phone" TEXT,
    "dueDate" TEXT,
    "gcalEventId" TEXT,
    "notionPageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingGroup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "BookingGroup_new" (
    "id",
    "customerId",
    "status",
    "projectTitle",
    "memo",
    "contactName",
    "companyName",
    "contactEmail",
    "phone",
    "dueDate",
    "gcalEventId",
    "notionPageId",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "customerId",
    "status",
    "projectTitle",
    "memo",
    "contactName",
    "companyName",
    "contactEmail",
    "phone",
    "dueDate",
    "gcalEventId",
    NULL,
    "createdAt",
    "updatedAt"
FROM "BookingGroup";

DROP TABLE "BookingGroup";
ALTER TABLE "BookingGroup_new" RENAME TO "BookingGroup";

CREATE INDEX "BookingGroup_status_idx" ON "BookingGroup"("status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
