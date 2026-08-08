#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let payload = {};
try {
  payload = input ? JSON.parse(input) : {};
} catch {
  process.exit(0);
}

if (payload.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const hygieneScript = path.join(projectDir, "scripts", "repo-hygiene.mjs");
const result = spawnSync(process.execPath, [hygieneScript, "--json"], {
  cwd: projectDir,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  const reason = result.error?.message || result.stderr.trim() || "repository hygiene check could not run";
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

if (report.errors?.length) {
  const reason = [
    "Repository hygiene is incomplete:",
    ...report.errors.map((message) => `- ${message}`),
    "Run pnpm repo:hygiene, resolve the listed items, then stop again.",
  ].join("\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
