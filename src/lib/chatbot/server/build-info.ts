import { execFileSync } from "node:child_process"

export type ChatbotBuildInfo = {
  commitSha: string
  worktreePath: string
  expectedRef: string
  buildTime: string
  commitShaSource: "env" | "git" | "unknown"
  expectedRefSource: "env" | "git" | "unknown"
}

const moduleLoadTime = new Date().toISOString()
const moduleWorktreePath = process.cwd()
const moduleGitCommitSha = readGitValue(moduleWorktreePath, ["rev-parse", "HEAD"])
const moduleGitExpectedRef = readGitValue(moduleWorktreePath, ["branch", "--show-current"])

export function getChatbotBuildInfo(): ChatbotBuildInfo {
  const envCommitSha = firstNonEmptyEnv(
    "CHATBOT_BUILD_SHA",
    "NEXT_PUBLIC_CHATBOT_BUILD_SHA",
    "VERCEL_GIT_COMMIT_SHA",
    "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
    "GIT_COMMIT_SHA",
  )
  const envExpectedRef = firstNonEmptyEnv(
    "CHATBOT_EXPECTED_REF",
    "NEXT_PUBLIC_CHATBOT_EXPECTED_REF",
    "VERCEL_GIT_COMMIT_REF",
    "NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF",
    "GIT_BRANCH",
  )

  return {
    commitSha: envCommitSha ?? moduleGitCommitSha ?? "unknown",
    worktreePath: moduleWorktreePath,
    expectedRef: envExpectedRef ?? moduleGitExpectedRef ?? "unknown",
    buildTime: firstNonEmptyEnv("CHATBOT_BUILD_TIME", "NEXT_PUBLIC_CHATBOT_BUILD_TIME") ?? moduleLoadTime,
    commitShaSource: envCommitSha ? "env" : moduleGitCommitSha ? "git" : "unknown",
    expectedRefSource: envExpectedRef ? "env" : moduleGitExpectedRef ? "git" : "unknown",
  }
}

export function getChatbotBuildSha(): string {
  return getChatbotBuildInfo().commitSha
}

function firstNonEmptyEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function readGitValue(cwd: string, args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim()
    return value || undefined
  } catch {
    return undefined
  }
}
