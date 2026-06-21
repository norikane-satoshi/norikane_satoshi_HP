import { describe, expect, it } from "vitest"

import {
  classifyLocal41238Runtime,
  hasOllamaModel,
} from "../../../../scripts/chatbot/local-tier-guard"

describe("local-tier-guard", () => {
  it("matches Ollama models by name or model field", () => {
    expect(
      hasOllamaModel(
        [
          { name: "nomic-embed-text:latest" },
          { model: "hf.co/mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M" },
        ],
        "hf.co/mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M",
      ),
    ).toBe(true)
  })

  it("does not match unrelated model entries", () => {
    expect(hasOllamaModel([{ name: "other-model" }, null, "plain-model"], "missing-model")).toBe(false)
  })

  it("flags the local 41238 runtime when its worktree is behind staging", () => {
    expect(
      classifyLocal41238Runtime({
        cwd: "/repo/.codex-worktrees/staging-live-41238",
        pid: "1423",
        head: "da114674991a34bd3f910f057b8c38ad42fef6b7",
        expectedHead: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        httpStatus: 200,
        dirtyFiles: 0,
      }),
    ).toMatchObject({
      status: "stale",
      cwd: "/repo/.codex-worktrees/staging-live-41238",
      pid: "1423",
    })
  })

  it("keeps the local 41238 runtime green when it matches staging", () => {
    expect(
      classifyLocal41238Runtime({
        cwd: "/repo/.codex-worktrees/staging-live-41238",
        pid: "1423",
        head: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        expectedHead: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        httpStatus: 200,
        dirtyFiles: 0,
      }),
    ).toMatchObject({
      status: "current",
      httpStatus: 200,
      dirtyFiles: 0,
    })
  })

  it("marks the local 41238 runtime yellow when staging matches but the worktree is dirty", () => {
    expect(
      classifyLocal41238Runtime({
        cwd: "/repo/.codex-worktrees/staging-live-41238",
        pid: "1423",
        head: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        expectedHead: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        httpStatus: 200,
        dirtyFiles: 3,
      }),
    ).toMatchObject({
      status: "dirty",
      dirtyFiles: 3,
    })
  })

  it("marks the local 41238 runtime red when the listener exists but HTTP is not healthy", () => {
    expect(
      classifyLocal41238Runtime({
        cwd: "/repo/.codex-worktrees/staging-live-41238",
        pid: "1423",
        head: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        expectedHead: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        httpStatus: 503,
        dirtyFiles: 0,
      }),
    ).toMatchObject({
      status: "unreachable",
      httpStatus: 503,
    })
  })

  it("marks the local 41238 runtime red when generated Prisma client is stale", () => {
    expect(
      classifyLocal41238Runtime({
        cwd: "/repo/.codex-worktrees/staging-live-41238",
        pid: "1423",
        head: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        expectedHead: "1a1108c1a79dd20a8915fb756425d6e6404f781f",
        httpStatus: 200,
        dirtyFiles: 0,
        prismaClientSchema: "stale",
      }),
    ).toMatchObject({
      status: "prisma-client-stale",
      prismaClientSchema: "stale",
    })
  })
})
