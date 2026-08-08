import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isManagedTaskWorktree, isPathWithin, parseFinishArgs } from "../../scripts/repo-finish-lib.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const finishScript = path.join(repoRoot, "scripts", "repo-finish.mjs");

function run(command, args, { cwd, env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited ${result.status}`);
  }
  return result;
}

function git(cwd, args, options) {
  return run("git", args, { cwd, ...options });
}

function createFixture(t, { integrated = true, lsofScript = "#!/bin/sh\nexit 1\n", worktree = true } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-finish-test-"));
  const remote = path.join(tempRoot, "origin.git");
  const repository = path.join(tempRoot, "repository");
  const bin = path.join(tempRoot, "bin");
  const branch = "codex/example-task";
  const worktreePath = path.join(repository, ".codex-worktrees", "example-task");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "lsof"), lsofScript, { mode: 0o755 });
  git(tempRoot, ["init", "--bare", remote]);
  git(tempRoot, ["init", "--initial-branch=master", repository]);
  git(repository, ["config", "user.name", "Repo Finish Test"]);
  git(repository, ["config", "user.email", "repo-finish@example.invalid"]);
  fs.writeFileSync(path.join(repository, ".gitignore"), ".codex-worktrees/\n");
  fs.writeFileSync(path.join(repository, "base.txt"), "base\n");
  git(repository, ["add", ".gitignore", "base.txt"]);
  git(repository, ["commit", "-m", "base"]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "-u", "origin", "master"]);

  git(repository, ["switch", "-c", branch]);
  fs.writeFileSync(path.join(repository, "task.txt"), "task\n");
  git(repository, ["add", "task.txt"]);
  git(repository, ["commit", "-m", "task"]);
  git(repository, ["push", "-u", "origin", branch]);
  git(repository, ["switch", "master"]);

  if (integrated) {
    git(repository, ["merge", "--ff-only", branch]);
    git(repository, ["push", "origin", "master"]);
  }
  if (worktree) git(repository, ["worktree", "add", worktreePath, branch]);

  return {
    branch,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    remote,
    repository,
    worktreePath,
  };
}

function refExists(repository, reference) {
  return git(repository, ["show-ref", "--verify", "--quiet", reference], { allowFailure: true }).status === 0;
}

test("parses an explicit branch and keeps execution dry-run by default", () => {
  assert.deepEqual(parseFinishArgs(["codex/example", "--target=origin/staging"]), {
    apply: false,
    branch: "codex/example",
    json: false,
    target: "origin/staging",
  });
  assert.throws(() => parseFinishArgs(["master"]), /Protected branch/);
  assert.throws(() => parseFinishArgs(["codex/example", "--target=HEAD"]), /Target must be one of/);
});

test("recognizes only nested managed task worktrees", () => {
  assert.equal(isPathWithin("/repo/.codex-worktrees", "/repo/.codex-worktrees/task"), true);
  assert.equal(isPathWithin("/repo/.codex-worktrees", "/repo/other"), false);
  assert.equal(isManagedTaskWorktree("/repo", "/repo/.claude/worktrees/task"), true);
  assert.equal(isManagedTaskWorktree("/repo", "/tmp/task"), false);
});

test("dry-run leaves an integrated branch lifecycle untouched", (t) => {
  const fixture = createFixture(t);
  const result = run(process.execPath, [finishScript, fixture.branch, "--target=origin/master"], {
    cwd: fixture.repository,
    env: fixture.env,
  });

  assert.match(result.stdout, /Repository finish preflight: OK/);
  assert.match(result.stdout, /Dry run only/);
  assert.equal(fs.existsSync(fixture.worktreePath), true);
  assert.equal(refExists(fixture.repository, `refs/heads/${fixture.branch}`), true);
  assert.notEqual(git(fixture.repository, ["ls-remote", "--heads", "origin", fixture.branch]).stdout.trim(), "");
});

test("apply removes only the clean integrated worktree and exact local/origin branch", (t) => {
  const fixture = createFixture(t);
  const result = run(
    process.execPath,
    [finishScript, fixture.branch, "--target=origin/master", "--apply", "--json"],
    { cwd: fixture.repository, env: fixture.env },
  );
  const report = JSON.parse(result.stdout);

  assert.equal(report.applied, true);
  assert.equal(report.branch, fixture.branch);
  assert.equal(report.worktreeRemoved, true);
  assert.equal(report.localDeleted, true);
  assert.equal(report.remoteDeleted, true);
  assert.equal(fs.existsSync(fixture.worktreePath), false);
  assert.equal(refExists(fixture.repository, `refs/heads/${fixture.branch}`), false);
  assert.equal(git(fixture.repository, ["ls-remote", "--heads", "origin", fixture.branch]).stdout.trim(), "");
  assert.equal(refExists(fixture.repository, "refs/heads/master"), true);
  assert.equal(git(fixture.repository, ["status", "--porcelain"]).stdout.trim(), "");
});

test("refuses an unmerged branch without deleting either ref", (t) => {
  const fixture = createFixture(t, { integrated: false, worktree: false });
  const result = run(
    process.execPath,
    [finishScript, fixture.branch, "--target=origin/master", "--apply"],
    { cwd: fixture.repository, env: fixture.env, allowFailure: true },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not integrated into origin\/master/);
  assert.equal(refExists(fixture.repository, `refs/heads/${fixture.branch}`), true);
  assert.notEqual(git(fixture.repository, ["ls-remote", "--heads", "origin", fixture.branch]).stdout.trim(), "");
});

test("refuses a dirty task worktree without deleting either ref", (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.worktreePath, "dirty.txt"), "do not delete\n");
  const result = run(
    process.execPath,
    [finishScript, fixture.branch, "--target=origin/master", "--apply"],
    { cwd: fixture.repository, env: fixture.env, allowFailure: true },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Task worktree is dirty/);
  assert.equal(fs.existsSync(fixture.worktreePath), true);
  assert.equal(refExists(fixture.repository, `refs/heads/${fixture.branch}`), true);
  assert.notEqual(git(fixture.repository, ["ls-remote", "--heads", "origin", fixture.branch]).stdout.trim(), "");
});

test("refuses a task worktree with an open handle", (t) => {
  const fixture = createFixture(t, {
    lsofScript: "#!/bin/sh\nprintf 'COMMAND PID NAME\\nnode 123 /repo/.codex-worktrees/example-task/file\\n'\nexit 0\n",
  });
  const result = run(
    process.execPath,
    [finishScript, fixture.branch, "--target=origin/master", "--apply"],
    { cwd: fixture.repository, env: fixture.env, allowFailure: true },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Task worktree has open handles/);
  assert.equal(fs.existsSync(fixture.worktreePath), true);
  assert.equal(refExists(fixture.repository, `refs/heads/${fixture.branch}`), true);
  assert.notEqual(git(fixture.repository, ["ls-remote", "--heads", "origin", fixture.branch]).stdout.trim(), "");
});
