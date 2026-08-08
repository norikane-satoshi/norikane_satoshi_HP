ALTER TABLE "ChatbotConversation" ADD COLUMN "slackThreadTs" TEXT;
ALTER TABLE "ChatbotConversation" ADD COLUMN "slackChannelId" TEXT;
ALTER TABLE "ChatbotConversation" ADD COLUMN "slackNotifiedAt" DATETIME;
