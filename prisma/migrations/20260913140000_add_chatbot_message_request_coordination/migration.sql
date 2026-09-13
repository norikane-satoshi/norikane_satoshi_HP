ALTER TABLE "ChatbotConversation" ADD COLUMN "activeMessageRequestKey" TEXT;
ALTER TABLE "ChatbotConversation" ADD COLUMN "activeMessageRequestOwner" TEXT;
ALTER TABLE "ChatbotConversation" ADD COLUMN "messageRequestLeaseExpiresAt" DATETIME;
ALTER TABLE "ChatbotConversation" ADD COLUMN "messageRequestVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ChatbotMessageRequest" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "owner" TEXT,
  "leaseExpiresAt" DATETIME,
  "resultJson" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "conversationVersion" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatbotMessageRequest_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChatbotConversation" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ChatbotMessageRequest_conversationId_createdAt_idx"
ON "ChatbotMessageRequest"("conversationId", "createdAt");

CREATE INDEX "ChatbotMessageRequest_status_leaseExpiresAt_idx"
ON "ChatbotMessageRequest"("status", "leaseExpiresAt");
