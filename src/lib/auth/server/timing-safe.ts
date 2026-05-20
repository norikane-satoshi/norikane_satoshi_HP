import bcrypt from "bcryptjs"

const DUMMY_HASH = bcrypt.hashSync("never-used-dummy-password", 12)

export async function timingSafeCompare(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH)
    return false
  }

  return bcrypt.compare(plain, hash)
}

export function randomDelay(minMs = 50, maxMs = 150): Promise<void> {
  const lower = Math.min(minMs, maxMs)
  const upper = Math.max(minMs, maxMs)
  const delay = lower + Math.floor(Math.random() * (upper - lower + 1))
  return new Promise((resolve) => setTimeout(resolve, delay))
}
