import { startHostedWorkerServer } from "@/lib/chatbot/hosted-worker"

async function main(): Promise<void> {
  const server = await startHostedWorkerServer()
  const address = server.address()

  console.log(
    JSON.stringify(
      {
        ok: true,
        service: "hosted-notion-ai-worker",
        address,
      },
      null,
      2,
    ),
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
