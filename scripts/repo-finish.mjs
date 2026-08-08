#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseWorktreePorcelain } from "./repo-hygiene-lib.mjs";
import { isManagedTaskWorktree, parseFinishArgs } from "./repo-finish-lib.mjs";

function run(command, args, { cwd, allowFailure = false, timeout = 30_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function git(args, options = {}) {
  return run("git", args, options);
}

function verifyRefName(branch, cwd) {
  const result = git(["check-ref-format", "--branch", branch], { cwd, allowFailure: true });
  if (result.status !== 0) throw new Error(`Invalid branch name: ${branch}`);
}

function resolveOptionalRef(reference, cwd) {
  const result = git(["rev-parse", "--verify", `${reference}^{commit}`], { cwd, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function remoteBranchSha(branch, cwd) {
  const result = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], { cwd });
  const line = result.stdout.trim();
  return line ? line.split(/\s+/)[0] : "";
}

function isAncestor(commit, target, cwd) {
  return git(["merge-base", "--is-ancestor", commit, target], { cwd, allowFailure: true }).status === 0;
}

function assertNoOpenHandles(worktreePath, cwd) {
  const result = run("lsof", ["-nP", "+D", worktreePath], {
    cwd,
    allowFailure: true,
    timeout: 60_000,
  });
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`Could not verify open handles for ${worktreePath}: ${detail}`);
  }
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const sample = lines.slice(1, 4).join(" | ");
  throw new Error(`Task worktree has open handles: ${worktreePath}${sample ? ` (${sample})` : ""}`);
}

function buildPreflight(options) {
  const invocationRoot = git(["rev-parse", "--show-toplevel"], { cwd: process.cwd() }).stdout.trim();
  const commonGitDir = git(["rev-parse", "--git-common-dir"], { cwd: invocationRoot }).stdout.trim();
  const mainRoot = path.dirname(path.resolve(invocationRoot, commonGitDir));

  if (path.resolve(invocationRoot) !== path.resolve(mainRoot)) {
    throw new Error(`Run repo:finish from the main checkout: ${mainRoot}`);
  }

  const mainBranch = git(["symbolic-ref", "--short", "HEAD"], { cwd: mainRoot, allowFailure: true }).stdout.trim();
  if (mainBranch !== "master") throw new Error(`Main checkout must be on master; found ${mainBranch || "detached HEAD"}`);

  const mainStatus = git(["status", "--porcelain", "--untracked-files=normal"], { cwd: mainRoot }).stdout.trim();
  if (mainStatus) throw new Error("Main checkout must be clean before finishing a task branch");

  verifyRefName(options.branch, mainRoot);
  git(["fetch", "--prune", "origin"], { cwd: mainRoot });

  const originMasterSha = resolveOptionalRef("origin/master", mainRoot);
  const masterSha = resolveOptionalRef("master", mainRoot);
  if (!originMasterSha || masterSha !== originMasterSha) {
    throw new Error("Main master must exactly match origin/master before finishing a task branch");
  }

  const targetSha = resolveOptionalRef(options.target, mainRoot);
  if (!targetSha) throw new Error(`Integration target is unavailable: ${options.target}`);

  const localRef = `refs/heads/${options.branch}`;
  const localSha = resolveOptionalRef(localRef, mainRoot);
  const remoteSha = remoteBranchSha(options.branch, mainRoot);
  if (!localSha && !remoteSha) throw new Error(`Branch does not exist locally or on origin: ${options.branch}`);
  if (localSha && remoteSha && localSha !== remoteSha) {
    throw new Error(`Local and origin branch tips differ for ${options.branch}`);
  }

  const branchSha = localSha || remoteSha;
  if (!isAncestor(branchSha, options.target, mainRoot)) {
    throw new Error(`${options.branch} (${branchSha.slice(0, 8)}) is not integrated into ${options.target}`);
  }

  const worktrees = parseWorktreePorcelain(git(["worktree", "list", "--porcelain"], { cwd: mainRoot }).stdout);
  const taskWorktrees = worktrees.filter((worktree) => worktree.branch === localRef);
  if (taskWorktrees.length > 1) throw new Error(`Multiple worktrees are attached to ${options.branch}`);

  const taskWorktree = taskWorktrees[0];
  if (taskWorktree) {
    if (!fs.existsSync(taskWorktree.path)) throw new Error(`Registered task worktree is missing: ${taskWorktree.path}`);
    const realWorktreePath = fs.realpathSync(taskWorktree.path);
    if (!isManagedTaskWorktree(fs.realpathSync(mainRoot), realWorktreePath)) {
      throw new Error(`Refusing to remove worktree outside managed roots: ${taskWorktree.path}`);
    }
    const taskStatus = git(["status", "--porcelain", "--untracked-files=normal"], { cwd: taskWorktree.path }).stdout.trim();
    if (taskStatus) throw new Error(`Task worktree is dirty: ${taskWorktree.path}`);
    assertNoOpenHandles(taskWorktree.path, mainRoot);
  }

  return {
    branch: options.branch,
    branchSha,
    localPresent: Boolean(localSha),
    localSha,
    mainRoot,
    remotePresent: Boolean(remoteSha),
    remoteSha,
    target: options.target,
    targetSha,
    worktreePath: taskWorktree?.path ?? null,
  };
}

function applyFinish(preflight) {
  if (preflight.worktreePath) {
    git(["worktree", "remove", preflight.worktreePath], { cwd: preflight.mainRoot });
  }

  if (preflight.remotePresent) {
    git([
      "push",
      `--force-with-lease=refs/heads/${preflight.branch}:${preflight.remoteSha}`,
      "origin",
      `:refs/heads/${preflight.branch}`,
    ], { cwd: preflight.mainRoot });
  }

  if (preflight.localPresent) {
    git(["update-ref", "-d", `refs/heads/${preflight.branch}`, preflight.localSha], { cwd: preflight.mainRoot });
  }
  git(["worktree", "prune"], { cwd: preflight.mainRoot });

  const remainingLocal = resolveOptionalRef(`refs/heads/${preflight.branch}`, preflight.mainRoot);
  const remainingRemote = remoteBranchSha(preflight.branch, preflight.mainRoot);
  if (remainingLocal || remainingRemote || (preflight.worktreePath && fs.existsSync(preflight.worktreePath))) {
    throw new Error(`Post-cleanup verification failed for ${preflight.branch}`);
  }
}

function outputResult(options, preflight, applied) {
  const result = {
    applied,
    branch: preflight.branch,
    branchSha: preflight.branchSha,
    localDeleted: applied && preflight.localPresent,
    remoteDeleted: applied && preflight.remotePresent,
    target: preflight.target,
    targetSha: preflight.targetSha,
    worktreePath: preflight.worktreePath,
    worktreeRemoved: applied && Boolean(preflight.worktreePath),
  };
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log("Repository finish preflight: OK");
  console.log(`Branch: ${preflight.branch} (${preflight.branchSha.slice(0, 8)})`);
  console.log(`Integrated into: ${preflight.target} (${preflight.targetSha.slice(0, 8)})`);
  console.log(`Worktree: ${preflight.worktreePath ?? "none"}`);
  console.log(`Local branch: ${preflight.localPresent ? "delete" : "already absent"}`);
  console.log(`Origin branch: ${preflight.remotePresent ? "delete" : "already absent"}`);
  console.log(applied ? "Repository finish: complete" : "Dry run only; rerun with --apply to remove the exact branch lifecycle.");
}

try {
  const options = parseFinishArgs(process.argv.slice(2));
  const preflight = buildPreflight(options);
  if (options.apply) applyFinish(preflight);
  outputResult(options, preflight, options.apply);
} catch (error) {
  console.error(`Repository finish refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
