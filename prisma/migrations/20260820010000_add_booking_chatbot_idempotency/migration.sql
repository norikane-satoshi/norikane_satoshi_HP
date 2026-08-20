ALTER TABLE "BookingGroup" ADD COLUMN "chatbotIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "BookingGroup_chatbotIdempotencyKey_key"
ON "BookingGroup"("chatbotIdempotencyKey");
