#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const DEFAULT_BASE = "ccba8e324bf6fadc7c678c3138dffc1fb45007ed";
const DEFAULT_ALLOWED = [
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/components/chatbot/widget/ChatbotWidget.tsx",
  "src/components/chatbot/widget/ThinkingIndicator.tsx",
  "src/components/chatbot/widget/WidgetShell.tsx",
  "src/components/chatbot/widget/__tests__/chatbot-widget.test.tsx",
  "src/components/chatbot/widget/__tests__/local-tier-debug.test.ts",
  "src/components/chatbot/widget/__tests__/widget-shell-api.test.tsx",
  "src/components/chatbot/widget/api.ts",
  "src/components/chatbot/widget/local-tier-debug.ts",
  "src/components/chatbot/widget/useWidgetState.ts",
];
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
