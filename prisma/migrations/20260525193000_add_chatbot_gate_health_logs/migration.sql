-- CreateTable
CREATE TABLE "ChatbotGateVerificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateNumber" INTEGER NOT NULL,
    "iteration" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChatbotHealthCheckLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "probeAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rateLimitRemaining" REAL,
    "modelSelectorPresent" BOOLEAN NOT NULL,
    "responseSuccess" BOOLEAN NOT NULL,
    "detailsJson" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "ChatbotGateVerificationLog_gateNumber_iteration_idx" ON "ChatbotGateVerificationLog"("gateNumber", "iteration");

-- CreateIndex
CREATE INDEX "ChatbotGateVerificationLog_executedAt_idx" ON "ChatbotGateVerificationLog"("executedAt");

-- CreateIndex
CREATE INDEX "ChatbotHealthCheckLog_probeAt_idx" ON "ChatbotHealthCheckLog"("probeAt");

-- CreateIndex
CREATE INDEX "ChatbotHealthCheckLog_responseSuccess_idx" ON "ChatbotHealthCheckLog"("responseSuccess");
