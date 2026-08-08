#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnvDocument, parseWorktreePorcelain } from "./repo-hygiene-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = new Set(process.argv.slice(2));
const ci = args.has("--ci") || process.env.CI === "true";
const strict = args.has("--strict");
const json = args.has("--json");
const errors = [];
const warnings = [];
const info = [];

const requiredIgnoreRules = [
  "/.agents/",
  "/.claire/",
  "/.claude/worktrees/",
  "/.codex-worktrees/",
  "/skills-lock.json",
  "/design-mockups/_candidates/",
  "/sozai/",
];

const requiredLocalEnvKeys = [
  "AUTH_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "GOOGLE_CALENDAR_OAUTH_CLIENT_ID",
  "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_CALENDAR_BUSY_SOURCE_ID",
];

function run(command, commandArgs, { cwd = repoRoot, allowFailure = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${commandArgs.join(" ")} failed: ${detail}`);
  }
  return result;
}

function git(commandArgs, options) {
  return run("git", commandArgs, options);
}

function isAncestor(commit, reference) {
  return git(["merge-base", "--is-ancestor", commit, reference], {
    allowFailure: true,
  }).status === 0;
}

function checkStaticPolicy() {
  const ignorePath = path.join(repoRoot, ".gitignore");
  const ignoreLines = new Set(fs.readFileSync(ignorePath, "utf8").split(/\r?\n/));
  for (const rule of requiredIgnoreRules) {
    if (!ignoreLines.has(rule)) errors.push(`.gitignore is missing ${rule}`);
  }

  const trackedLocalFiles = git([
    "ls-files",
    "--",
    ".agents",
    ".claire",
    ".claude/worktrees",
    ".codex-worktrees",
    "skills-lock.json",
    "design-mockups/_candidates",
    "sozai",
  ]).stdout.trim();
  if (trackedLocalFiles) {
    errors.push(`local-only paths are tracked: ${trackedLocalFiles.split("\n").join(", ")}`);
  }
}

function checkLocalState() {
  const commonGitDir = git(["rev-parse", "--git-common-dir"]).stdout.trim();
  const resolvedGitDir = path.resolve(repoRoot, commonGitDir);
  const mainRoot = path.dirname(resolvedGitDir);
  const worktrees = parseWorktreePorcelain(git(["worktree", "list", "--porcelain"]).stdout);
  const mainWorktree = worktrees.find((worktree) => worktree.path === mainRoot);

  if (!mainWorktree) {
    errors.push(`main checkout was not found at ${mainRoot}`);
    return;
  }

  const mainBranchResult = git(["-C", mainRoot, "symbolic-ref", "--short", "HEAD"], {
    allowFailure: true,
  });
  const mainBranch = mainBranchResult.stdout.trim();
  if (mainBranch !== "master") errors.push(`main checkout must be on master; found ${mainBranch || "detached HEAD"}`);

  const originMaster = git(["rev-parse", "--verify", "origin/master"], { allowFailure: true });
  if (originMaster.status !== 0) {
    errors.push("origin/master is unavailable; run git fetch origin");
  } else {
    const counts = git(["-C", mainRoot, "rev-list", "--left-right", "--count", "master...origin/master"])
      .stdout.trim().split(/\s+/).map(Number);
    const [ahead, behind] = counts;
    if (ahead || behind) errors.push(`main master differs from origin/master (ahead ${ahead}, behind ${behind})`);
  }

  const mainStatus = git(["-C", mainRoot, "status", "--porcelain", "--untracked-files=normal"]).stdout.trim();
  if (mainStatus) errors.push("main checkout contains tracked changes or unclassified untracked files");

  const pruneCandidates = git(["worktree", "prune", "--dry-run", "--verbose"]).stdout.trim();
  if (pruneCandidates) errors.push("stale worktree metadata exists; run git worktree prune after inspection");

  const protectedNames = new Set(["staging-live-41238", "grading-verify"]);
  for (const worktree of worktrees) {
    if (worktree.path === mainRoot || protectedNames.has(path.basename(worktree.path))) continue;
    if (!fs.existsSync(worktree.path)) {
      errors.push(`registered worktree is missing: ${worktree.path}`);
      continue;
    }
    const status = git(["-C", worktree.path, "status", "--porcelain", "--untracked-files=normal"]).stdout.trim();
    if (status) {
      warnings.push(`active or interrupted worktree is dirty: ${worktree.path}`);
      continue;
    }
    const integrated = ["origin/master", "origin/staging"].some((reference) =>
      isAncestor(worktree.head, reference),
    );
    if (integrated) errors.push(`clean integrated task worktree should be removed: ${worktree.path}`);
    else info.push(`clean unmerged task worktree retained: ${worktree.path}`);
  }

  const envPath = path.join(mainRoot, ".env.local");
  if (!fs.existsSync(envPath)) {
    warnings.push(".env.local is missing");
  } else {
    const env = parseEnvDocument(fs.readFileSync(envPath, "utf8"));
    const missing = requiredLocalEnvKeys.filter((key) => !env.assignments.get(key)?.value);
    if (missing.length) warnings.push(`required local env values are unresolved: ${missing.join(", ")}`);
  }
}

try {
  checkStaticPolicy();
  if (!ci) checkLocalState();
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

const report = { ok: errors.length === 0, errors, warnings, info };
if (json) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  const prefix = report.ok ? "Repository hygiene: OK" : "Repository hygiene: action required";
  console.log(prefix);
  for (const message of errors) console.error(`ERROR: ${message}`);
  for (const message of warnings) console.warn(`WARN: ${message}`);
  for (const message of info) console.log(`INFO: ${message}`);
}

if (strict && errors.length) process.exitCode = 2;
