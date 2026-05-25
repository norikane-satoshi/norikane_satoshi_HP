type GateVerificationCreateInput = {
  data: {
    gateNumber: number
    iteration: number
    passed: boolean
    detailsJson: string
    executedAt?: Date
  }
}

type HealthCheckCreateInput = {
  data: {
    probeAt: Date
    rateLimitRemaining?: number | null
    modelSelectorPresent: boolean
    responseSuccess: boolean
    detailsJson: string
  }
}

export type ChatbotOpsLogClient = {
  chatbotGateVerificationLog: {
    create(input: GateVerificationCreateInput): Promise<unknown>
  }
  chatbotHealthCheckLog: {
    create(input: HealthCheckCreateInput): Promise<unknown>
    findMany?(input: {
      orderBy: { probeAt: "desc" }
      take: number
      select: { responseSuccess: true }
    }): Promise<Array<{ responseSuccess: boolean }>>
  }
}

export async function recordChatbotGateVerification(input: {
  client: ChatbotOpsLogClient
  gateNumber: number
  iteration: number
  passed: boolean
  details: Record<string, unknown>
  executedAt?: Date
}): Promise<void> {
  await input.client.chatbotGateVerificationLog.create({
    data: {
      gateNumber: input.gateNumber,
      iteration: input.iteration,
      passed: input.passed,
      detailsJson: JSON.stringify(input.details),
      executedAt: input.executedAt,
    },
  })
}

export async function recordChatbotHealthCheck(input: {
  client: ChatbotOpsLogClient
  probeAt: Date
  rateLimitRemaining?: number | null
  modelSelectorPresent: boolean
  responseSuccess: boolean
  details: Record<string, unknown>
}): Promise<void> {
  await input.client.chatbotHealthCheckLog.create({
    data: {
      probeAt: input.probeAt,
      rateLimitRemaining: input.rateLimitRemaining ?? null,
      modelSelectorPresent: input.modelSelectorPresent,
      responseSuccess: input.responseSuccess,
      detailsJson: JSON.stringify(input.details),
    },
  })
}

export async function countRecentHealthFailures(input: {
  client: ChatbotOpsLogClient
  includeCurrentSuccess: boolean
  windowSize: number
}): Promise<number> {
  if (!input.client.chatbotHealthCheckLog.findMany) {
    return input.includeCurrentSuccess ? 0 : 1
  }

  const previousRows = await input.client.chatbotHealthCheckLog.findMany({
    orderBy: { probeAt: "desc" },
    take: Math.max(input.windowSize - 1, 0),
    select: { responseSuccess: true },
  })
  const statuses = [input.includeCurrentSuccess, ...previousRows.map((row) => row.responseSuccess)]
  let failures = 0

  for (const status of statuses) {
    if (status) break
    failures += 1
  }

  return failures
}
