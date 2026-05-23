-- AlterTable
ALTER TABLE "BookingGroup" ADD COLUMN "chatConversationId" TEXT;
ALTER TABLE "BookingGroup" ADD COLUMN "originatedFrom" TEXT;

-- CreateTable
CREATE TABLE "ChatbotConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" DATETIME NOT NULL,
    "routingDecision" TEXT,
    "inquirySentAt" DATETIME,
    "bookingId" TEXT,
    "customerName" TEXT,
    "customerCompany" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "finalMedium" TEXT,
    "jobType" TEXT,
    "mainDuration" TEXT,
    "workSite" TEXT,
    "workSiteDetails" TEXT,
    "attachments" TEXT,
    "additionalWork" TEXT,
    "referenceUrls" TEXT,
    "ndaFlag" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ChatbotMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" TEXT,
    "llmModel" TEXT,
    "llmThinking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatbotMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatbotConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatbotSurveyResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "selectedValues" TEXT NOT NULL,
    "freeText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatbotSurveyResponse_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatbotConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatbotInquiry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "finalMedium" TEXT,
    "jobType" TEXT,
    "mainDuration" TEXT,
    "workSite" TEXT,
    "workSiteDetails" TEXT,
    "attachments" TEXT,
    "additionalWork" TEXT,
    "referenceUrls" TEXT,
    "desiredDeadline" TEXT,
    "freeText" TEXT NOT NULL,
    "aiSummary" TEXT NOT NULL,
    "workflowEstimate" TEXT,
    "candidateWindows" TEXT,
    "sentReason" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatbotInquiry_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatbotConversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotConversation_sessionId_key" ON "ChatbotConversation"("sessionId");

-- CreateIndex
CREATE INDEX "ChatbotConversation_startedAt_idx" ON "ChatbotConversation"("startedAt");

-- CreateIndex
CREATE INDEX "ChatbotConversation_routingDecision_idx" ON "ChatbotConversation"("routingDecision");

-- CreateIndex
CREATE INDEX "ChatbotConversation_userId_idx" ON "ChatbotConversation"("userId");

-- CreateIndex
CREATE INDEX "ChatbotMessage_conversationId_createdAt_idx" ON "ChatbotMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatbotSurveyResponse_conversationId_idx" ON "ChatbotSurveyResponse"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotInquiry_conversationId_key" ON "ChatbotInquiry"("conversationId");

-- CreateIndex
CREATE INDEX "ChatbotInquiry_sentAt_idx" ON "ChatbotInquiry"("sentAt");
