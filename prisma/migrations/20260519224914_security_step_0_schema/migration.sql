-- AlterTable
ALTER TABLE "BookingGroup" ADD COLUMN "pendingExpiresAt" DATETIME;

-- AlterTable
ALTER TABLE "BookingTimeSlot" ADD COLUMN "previousEndTime" DATETIME;
ALTER TABLE "BookingTimeSlot" ADD COLUMN "previousStartTime" DATETIME;

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VerificationToken" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AdminActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "payload" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TeamInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "tokenHash" TEXT,
    "teamId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "invitedEmail" TEXT,
    "expiresAt" DATETIME,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" DATETIME,
    "usedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamInvitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamInvitation_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TeamInvitation" ("createdAt", "createdByUserId", "id", "teamId", "token", "usedAt", "usedByUserId") SELECT "createdAt", "createdByUserId", "id", "teamId", "token", "usedAt", "usedByUserId" FROM "TeamInvitation";
DROP TABLE "TeamInvitation";
ALTER TABLE "new_TeamInvitation" RENAME TO "TeamInvitation";
CREATE UNIQUE INDEX "TeamInvitation_token_key" ON "TeamInvitation"("token");
CREATE INDEX "TeamInvitation_teamId_idx" ON "TeamInvitation"("teamId");
CREATE INDEX "TeamInvitation_createdByUserId_idx" ON "TeamInvitation"("createdByUserId");
CREATE INDEX "TeamInvitation_usedByUserId_idx" ON "TeamInvitation"("usedByUserId");
CREATE TABLE "new_TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_role_check" CHECK ("role" IN ('OWNER', 'ADMIN', 'MEMBER'))
);
INSERT INTO "new_TeamMember" ("createdAt", "id", "teamId", "userId") SELECT "createdAt", "id", "teamId", "userId" FROM "TeamMember";
DROP TABLE "TeamMember";
ALTER TABLE "new_TeamMember" RENAME TO "TeamMember";
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "TeamMember"("userId", "teamId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "passwordHash" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "image", "name", "passwordHash", "updatedAt") SELECT "createdAt", "email", "emailVerified", "id", "image", "name", "passwordHash", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AdminActionLog_action_idx" ON "AdminActionLog"("action");

-- CreateIndex
CREATE INDEX "AdminActionLog_createdAt_idx" ON "AdminActionLog"("createdAt");
