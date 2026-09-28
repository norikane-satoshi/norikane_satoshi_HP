import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  classifyCleanWorktree,
  findIntegratedLocalBranches,
  isExemptWorktreePath,
  mergeEnvText,
  parseWorktreePorcelain,
  readServingWorktreeState,
} from "../../scripts/repo-hygiene-lib.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

function servingFixture({ cwd = "", job, loaded = false } = {}) {
  return readServingWorktreeState({
    platform: "darwin",
    home: "/fake-home",
    readDirectory: () => ["preview.plist"],
    run: (command, args) => {
      if (command === "lsof") {
        assert.deepEqual(args, ["-a", "-d", "cwd", "-Fn"]);
        return { status: cwd ? 0 : 1, stdout: cwd ? `p123\nfcwd\nn${cwd}\n` : "" };
      }
      if (command === "plutil") {
        assert.deepEqual(args, ["-convert", "json", "-o", "-", "/fake-home/Library/LaunchAgents/preview.plist"]);
        return { status: 0, stdout: JSON.stringify(job || {}) };
      }
      assert.equal(command, "launchctl");
      assert.deepEqual(args, ["list", job.Label]);
      return { status: loaded ? 0 : 1, stdout: "" };
    },
  });
}

test("integrated worktrees with a process cwd at or below any tree are INFO, not ERROR", () => {
  const worktree = { path: "/repo/.codex-worktrees/arbitrary-preview" };
  for (const cwd of [worktree.path, `${worktree.path}/nested directory`]) {
    const result = classifyCleanWorktree(worktree, {
      integrated: true, servingState: servingFixture({ cwd }),
    });
    assert.equal(result.level, "info");
    assert.match(result.message, /active serving worktree retained/);
  }
});

test("inactive integrated worktrees still produce the original removal ERROR", () => {
  const worktree = { path: "/repo/.codex-worktrees/arbitrary-preview" };
  for (const cwd of ["", `${worktree.path}-other`, "/repo"]) {
    assert.deepEqual(classifyCleanWorktree(worktree, {
      integrated: true, servingState: servingFixture({ cwd }),
    }), {
      level: "errors", message: `clean integrated task worktree should be removed: ${worktree.path}`,
    });
  }
});

test("only loaded launchd jobs protect trees referenced by directory or arguments", () => {
  const worktree = { path: "/repo/.codex-worktrees/another preview" };
  for (const reference of [
    { WorkingDirectory: worktree.path },
    { ProgramArguments: ["node", `${worktree.path}/server.mjs`] },
    { ProgramArguments: ["/bin/sh", "-c", `cd '${worktree.path}' && pnpm start`] },
  ]) {
    for (const loaded of [true, false]) {
      const result = classifyCleanWorktree(worktree, {
        integrated: true,
        servingState: servingFixture({ job: { Label: "local.preview", ...reference }, loaded }),
      });
      assert.equal(result.level, loaded ? "info" : "errors");
    }
  }
  const result = classifyCleanWorktree(worktree, {
    integrated: true,
    servingState: servingFixture({
      job: { Label: "local.preview", ProgramArguments: [`${worktree.path}-other/server.mjs`] }, loaded: true,
    }),
  });
  assert.equal(result.level, "errors");
});

test("missing inspection commands do not permanently exempt inactive trees", () => {
  const servingState = readServingWorktreeState({
    platform: "linux",
    run: () => ({ status: null, error: new Error("ENOENT") }),
  });
  assert.equal(classifyCleanWorktree({ path: "/repo/task" }, { integrated: true, servingState }).level, "errors");
});

test("only the main checkout and grading verification worktree are exempt", () => {
  assert.equal(isExemptWorktreePath("/repo", "/repo"), true);
  assert.equal(isExemptWorktreePath("/repo/.codex-worktrees/grading-verify", "/repo"), true);
  assert.equal(isExemptWorktreePath("/repo/.codex-worktrees/staging-live-41238", "/repo"), false);
});

test("preserves a non-empty local value when Vercel returns an empty encrypted value", () => {
  const result = mergeEnvText(
    'SECRET="local-secret"\nPUBLIC_VALUE="old"\n',
    'SECRET=""\nPUBLIC_VALUE="new"\n',
    { requiredKeys: ["SECRET"] },
  );

  assert.match(result.text, /SECRET="local-secret"/);
  assert.match(result.text, /PUBLIC_VALUE="new"/);
  assert.deepEqual(result.preserved, ["SECRET"]);
  assert.deepEqual(result.updated, ["PUBLIC_VALUE"]);
  assert.deepEqual(result.unresolved, []);
});

test("reports a required value that is empty in both sources", () => {
  const result = mergeEnvText('SECRET=""\n', 'SECRET=""\n', {
    requiredKeys: ["SECRET"],
  });

  assert.deepEqual(result.unresolved, ["SECRET"]);
});

test("parses linked, main, and detached worktrees", () => {
  const worktrees = parseWorktreePorcelain([
    "worktree /repo",
    "HEAD abc123",
    "branch refs/heads/master",
    "",
    "worktree /repo/.codex-worktrees/review",
    "HEAD def456",
    "detached",
    "",
  ].join("\n"));

  assert.equal(worktrees.length, 2);
  assert.equal(worktrees[0].branch, "refs/heads/master");
  assert.equal(worktrees[1].detached, true);
});

test("finds only integrated local branches that no worktree protects", () => {
  const ancestry = new Map([
    ["codex/done:origin/master", true],
    ["codex/staging-only:origin/staging", true],
    ["codex/attached:origin/master", true],
  ]);
  const result = findIntegratedLocalBranches(
    ["master", "codex/done", "codex/staging-only", "codex/attached", "codex/wip"],
    {
      attachedBranches: new Set(["refs/heads/codex/attached"]),
      protectedBranches: new Set(["master", "staging"]),
      targets: ["origin/master", "origin/staging"],
      isAncestor: (branch, target) => ancestry.get(`${branch}:${target}`) === true,
    },
  );

  assert.deepEqual(result, [
    { branch: "codex/done", target: "origin/master" },
    { branch: "codex/staging-only", target: "origin/staging" },
  ]);
});

test("safe pull keeps encrypted local values while accepting non-empty updates", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-hygiene-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const binDir = path.join(tempDir, "bin");
  const targetPath = path.join(tempDir, ".env.local");
  const fakeVercelPath = path.join(binDir, "vercel");
  fs.mkdirSync(binDir);

  fs.writeFileSync(
    fakeVercelPath,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      "const target = process.argv[4];",
      "fs.writeFileSync(target, [",
      "  'AUTH_SECRET=\"\"',",
      "  'TURSO_DATABASE_URL=\"libsql://new.example\"',",
      "  'TURSO_AUTH_TOKEN=\"\"',",
      "  'GOOGLE_CALENDAR_OAUTH_CLIENT_ID=\"\"',",
      "  'GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=\"\"',",
      "  'GOOGLE_CALENDAR_REDIRECT_URI=\"https://new.example/callback\"',",
      "  'GOOGLE_CALENDAR_BUSY_SOURCE_ID=\"calendar-new\"',",
      "  ''",
      "].join('\\n'));",
    ].join("\n"),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    targetPath,
    [
      'AUTH_SECRET="keep-auth"',
      'TURSO_DATABASE_URL="libsql://old.example"',
      'TURSO_AUTH_TOKEN="keep-turso"',
      'GOOGLE_CALENDAR_OAUTH_CLIENT_ID="keep-client"',
      'GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET="keep-secret"',
      'GOOGLE_CALENDAR_REDIRECT_URI="https://old.example/callback"',
      'GOOGLE_CALENDAR_BUSY_SOURCE_ID="calendar-old"',
      "",
    ].join("\n"),
  );

  const result = spawnSync(
    process.execPath,
    ["scripts/vercel-env-pull-safe.mjs", "--environment=production", `--target=${targetPath}`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const written = fs.readFileSync(targetPath, "utf8");
  assert.match(written, /AUTH_SECRET="keep-auth"/);
  assert.match(written, /GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET="keep-secret"/);
  assert.match(written, /TURSO_DATABASE_URL="libsql:\/\/new\.example"/);
  assert.match(written, /GOOGLE_CALENDAR_REDIRECT_URI="https:\/\/new\.example\/callback"/);
  assert.match(result.stdout, /4 non-empty local values preserved/);
});
