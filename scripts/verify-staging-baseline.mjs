#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const DEFAULT_BASE = "55e000e218210a6125e43022eaf09d45dc5098c0";
// Default mode protects the current staging baseline from unreviewed drift.
// For scoped integration checks, pass --base <previous staging tip> and exact --allow paths.
const DEFAULT_ALLOWED = [];
const SELF_ALLOWED = [
  "CONTRIBUTING.md",
  "package.json",
  "scripts/verify-staging-baseline.mjs",
];

function usage() {
  console.error(
    "Usage: pnpm verify:staging-baseline -- --base <commit> --allow <path> [--allow <path>...]",
  );
}

function normalizePath(value) {
  return value.replace(/^\.\//, "").replace(/\/+$/, "");
}

const args = process.argv.slice(2);
let base = DEFAULT_BASE;
const allowed = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--") {
    continue;
  }
  if (arg === "--base") {
    const value = args[index + 1];
    if (!value) {
      usage();
      process.exit(2);
    }
    base = value;
    index += 1;
    continue;
  }
  if (arg === "--allow") {
    const value = args[index + 1];
    if (!value) {
      usage();
      process.exit(2);
    }
    allowed.push(normalizePath(value));
    index += 1;
    continue;
  }
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  usage();
  process.exit(2);
}

const allowedPaths = new Set([
  ...SELF_ALLOWED,
  ...(allowed.length > 0 ? allowed : DEFAULT_ALLOWED),
]);

let diffOutput = "";
try {
  diffOutput = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${base}..HEAD`, "--"],
    { encoding: "utf8" },
  );
} catch (error) {
  console.error(`Failed to diff against baseline ${base}.`);
  if (error.stderr) {
    console.error(String(error.stderr).trim());
  }
  process.exit(2);
}

const changedFiles = diffOutput
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map(normalizePath);

const unexpected = changedFiles.filter((file) => !allowedPaths.has(file));

if (unexpected.length > 0) {
  console.error(`staging baseline check failed: ${unexpected.length} unexpected file(s).`);
  console.error("Unexpected files:");
  for (const file of unexpected) {
    console.error(`- ${file}`);
  }
  console.error("Allowed files:");
  for (const file of [...allowedPaths].sort()) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`staging baseline check passed: ${changedFiles.length} changed file(s).`);
