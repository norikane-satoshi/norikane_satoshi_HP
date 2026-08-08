#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeEnvText } from "./repo-hygiene-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const argv = process.argv.slice(2);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

const environment = option("environment", "development");
const targetPath = path.resolve(repoRoot, option("target", ".env.local"));
const requiredKeys = [
  "AUTH_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "GOOGLE_CALENDAR_OAUTH_CLIENT_ID",
  "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_CALENDAR_BUSY_SOURCE_ID",
];

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "norikane-hp-vercel-env-"));
const pulledPath = path.join(tempDir, ".env.pulled");

try {
  const pull = spawnSync(
    "vercel",
    ["env", "pull", pulledPath, `--environment=${environment}`, "--yes"],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (pull.error) throw pull.error;
  if (pull.status !== 0) throw new Error(`vercel env pull failed with exit ${pull.status}`);

  const currentText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
  const pulledText = fs.readFileSync(pulledPath, "utf8");
  const merged = mergeEnvText(currentText, pulledText, { requiredKeys });

  if (merged.unresolved.length) {
    console.error(`Environment pull refused; required values remain empty: ${merged.unresolved.join(", ")}`);
    console.error("Unlock the authoritative secret store and restore these values before retrying.");
    process.exitCode = 2;
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const atomicPath = `${targetPath}.tmp-${process.pid}`;
    fs.writeFileSync(atomicPath, merged.text, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(atomicPath, targetPath);
    fs.chmodSync(targetPath, 0o600);
    console.log(
      `Environment updated safely (${merged.updated.length} updated, ${merged.preserved.length} non-empty local values preserved).`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
