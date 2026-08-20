CREATE TABLE "ChatbotAuditEvent" (
    "eventId" TEXT NOT NULL PRIMARY KEY,
    "schemaVersion" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "conversationHash" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "tier" TEXT,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "uiKind" TEXT,
    "payloadJson" TEXT NOT NULL,
    "buildSha" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
);

CREATE INDEX "ChatbotAuditEvent_correlationId_createdAt_idx"
ON "ChatbotAuditEvent"("correlationId", "createdAt");

CREATE INDEX "ChatbotAuditEvent_conversationHash_createdAt_idx"
ON "ChatbotAuditEvent"("conversationHash", "createdAt");

CREATE INDEX "ChatbotAuditEvent_eventName_createdAt_idx"
ON "ChatbotAuditEvent"("eventName", "createdAt");

CREATE INDEX "ChatbotAuditEvent_result_createdAt_idx"
ON "ChatbotAuditEvent"("result", "createdAt");
