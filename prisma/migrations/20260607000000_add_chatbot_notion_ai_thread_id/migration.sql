ALTER TABLE "ChatbotConversation" ADD COLUMN "notionAiThreadId" TEXT;

CREATE UNIQUE INDEX "ChatbotConversation_notionAiThreadId_key" ON "ChatbotConversation"("notionAiThreadId");
