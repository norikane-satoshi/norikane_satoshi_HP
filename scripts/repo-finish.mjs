#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { parseWorktreePorcelain } from "./repo-hygiene-lib.mjs";
import { registeredTaskWorkspace, parseFinishArgs } from "./repo-finish-lib.mjs";

const lifecycleCli = path.join(os.homedir(), "clawd/tools/workspace_lifecycle/cli.py");

function lifecycle(args) {
  return JSON.parse(run("python3", [lifecycleCli, ...args, "--json"], { timeout: 300_000 }).stdout);
}

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
  lifecycle(["policy", "verify", "--require-installed"]);
  lifecycle(["adapter-attest", "--adapter-id", "codex-app", "--capability", "disposal"]);
  const registry = lifecycle(["list"]);
  const branches = registry.branches.filter((record) =>
    path.resolve(record.repository) === path.resolve(mainRoot) && record.branch === options.branch &&
    !["removed", "disposed", "tombstoned", "superseded"].includes(record.state),
  );
  if (localSha && branches.length !== 1) throw new Error("Local branch must have one exact lifecycle registration");
  let workspace = null;
  if (taskWorktree) {
    if (!fs.existsSync(taskWorktree.path)) throw new Error(`Registered task worktree is missing: ${taskWorktree.path}`);
    const realWorktreePath = fs.realpathSync(taskWorktree.path);
    const records = registry.workspaces.filter((record) => path.resolve(record.path) === realWorktreePath)
      .map((record) => lifecycle(["show", "--workspace-id", record.workspace_id]));
    workspace = registeredTaskWorkspace(records, fs.realpathSync(mainRoot), realWorktreePath, options.branch);
    if (branches[0]?.workspace_id !== workspace.workspace_id) {
      throw new Error("Branch registration must bind to the exact task workspace");
    }
    const taskStatus = git(["status", "--porcelain", "--untracked-files=normal"], { cwd: taskWorktree.path }).stdout.trim();
    if (taskStatus) throw new Error(`Task worktree is dirty: ${taskWorktree.path}`);
    const audit = lifecycle(["audit", "--workspace-id", workspace.workspace_id]);
    if (audit.processes?.length || audit.listeners?.length || audit.runtime?.running) {
      throw new Error(`Task worktree is in use: ${taskWorktree.path}`);
    }
    const pendingFinalization = new Set(["physical_disposal_not_authorized", "artifact_state_unresolved"]);
    const blockers = audit.reasons.filter((reason) => !pendingFinalization.has(reason));
    if (blockers.length) throw new Error(`Lifecycle audit refused: ${blockers.join(", ")}`);
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
    workspace,
    branchId: branches[0]?.branch_id ?? null,
  };
}

function applyFinish(preflight) {
  if (preflight.worktreePath) {
    const workspace = lifecycle(["show", "--workspace-id", preflight.workspace.workspace_id]);
    const owner = ["--owner-agent", workspace.effective_owner_agent, "--owner-task", workspace.effective_owner_task, "--adapter-id", "codex-app"];
    const metadata = JSON.parse(workspace.metadata_json || "{}");
    if (["retained", "quarantined"].includes(workspace.state) || metadata.cleanup_requested || metadata.resume_retention?.status === "retained") {
      lifecycle(["restore-for-mutation", "--workspace-id", workspace.workspace_id, ...owner, "--reason", "Authorized exact integrated branch cleanup"]);
    }
    lifecycle(["artifact-update", "--workspace-id", workspace.workspace_id, "--artifact-status", "promoted", "--artifact-evidence-json", JSON.stringify({
      kind: "git-commit", commit: preflight.branchSha, ref: preflight.target, repository: preflight.mainRoot,
    }), "--adapter-id", "codex-app"]);
    lifecycle(["finalize", "--workspace-id", workspace.workspace_id, ...owner]);
    lifecycle(["dispose", "--workspace-id", workspace.workspace_id, "--adapter-id", "codex-app"]);
  }

  if (preflight.localPresent) {
    lifecycle(["branch-dispose", "--branch-id", preflight.branchId, "--adapter-id", "codex-app"]);
  }

  if (preflight.remotePresent) {
    git([
      "push",
      `--force-with-lease=refs/heads/${preflight.branch}:${preflight.remoteSha}`,
      "origin",
      `:refs/heads/${preflight.branch}`,
    ], { cwd: preflight.mainRoot });
  }


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
