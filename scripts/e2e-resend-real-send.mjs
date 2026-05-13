import { config as loadDotenv } from "dotenv"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

const TO = "norikane.satoshi@gmail.com"
const PROJECT_TITLE = "【テスト】Resend 実送信疎通確認"
const START = "2026-06-15T10:00:00+09:00"
const END = "2026-06-15T18:00:00+09:00"

const emailModule = await import("../src/lib/booking/email.ts")
const { sendBookingConfirmedEmail } =
  emailModule.default ?? emailModule["module.exports"] ?? emailModule

const baseArgs = {
  to: TO,
  projectTitle: PROJECT_TITLE,
  start: START,
  end: END,
  workScopes: ["カラーグレーディング", "その他"],
  otherWorkDetail: "顧客名: テスト 太郎\nメモ: Resend 実送信テスト",
  estimatedDuration: "full-day",
}

function assertSendResult(tag, result) {
  if (!result || result.skipped === true) {
    throw new Error(`Resend real-send ${tag} was skipped`)
  }
  if (typeof result.id !== "string" || result.id.length === 0) {
    throw new Error(`Resend real-send ${tag} did not return an id`)
  }
  return result.id
}

const result = await sendBookingConfirmedEmail(baseArgs)
const id = assertSendResult("confirmed", result)
console.log(`sent tag=confirmed id=${id}`)
console.log(JSON.stringify({ confirmed: id }, null, 2))
