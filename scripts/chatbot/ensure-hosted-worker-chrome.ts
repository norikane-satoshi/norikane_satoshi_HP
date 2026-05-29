import { ensureHostedWorkerChrome } from "@/lib/chatbot/hosted-worker"

async function main(): Promise<void> {
  const result = await ensureHostedWorkerChrome()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
