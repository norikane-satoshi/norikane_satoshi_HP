PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "usedAt" DATETIME,
    "usedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamInvitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamInvitation_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "BookingGroup" ADD COLUMN "teamId" TEXT REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Team_createdByUserId_idx" ON "Team"("createdByUserId");
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "TeamMember"("userId", "teamId");
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");
CREATE UNIQUE INDEX "TeamInvitation_token_key" ON "TeamInvitation"("token");
CREATE INDEX "TeamInvitation_teamId_idx" ON "TeamInvitation"("teamId");
CREATE INDEX "TeamInvitation_createdByUserId_idx" ON "TeamInvitation"("createdByUserId");
CREATE INDEX "TeamInvitation_usedByUserId_idx" ON "TeamInvitation"("usedByUserId");
CREATE INDEX "BookingGroup_teamId_idx" ON "BookingGroup"("teamId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
