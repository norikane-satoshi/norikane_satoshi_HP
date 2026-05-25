import { runTier1HealthCheck } from "@/lib/chatbot/server/llm-clients/tier1-health-check"
import { createLocalPrismaClient } from "./local-prisma"

async function main(): Promise<void> {
  const prisma = createLocalPrismaClient()

  try {
    const result = await runTier1HealthCheck({ logClient: prisma })
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
