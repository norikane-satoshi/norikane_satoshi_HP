import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

// Keep host inspection injectable: tests must not depend on live processes/jobs.
export function readServingWorktreeState({
  run = spawnSync,
  platform = process.platform,
  home = os.homedir(),
  readDirectory = fs.readdirSync,
} = {}) {
  const query = (command, args) => run(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  const cwdResult = query("lsof", ["-a", "-d", "cwd", "-Fn"]);
  const cwdPaths = (cwdResult.stdout || "").split(/\r?\n/)
    .filter((line) => line.startsWith("n/")).map((line) => line.slice(1));
  const jobs = [];
  if (platform === "darwin") {
    const directory = path.join(home, "Library", "LaunchAgents");
    let entries = [];
    try {
      entries = readDirectory(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const entry of entries.filter((name) => name.endsWith(".plist"))) {
      const result = query("plutil", ["-convert", "json", "-o", "-", path.join(directory, entry)]);
      if (result.status !== 0) continue;
      let job;
      try {
        job = JSON.parse(result.stdout);
      } catch {
        continue;
      }
      // A plist on disk alone does not establish that its job is loaded.
      if (typeof job.Label === "string" && query("launchctl", ["list", job.Label]).status === 0) {
        jobs.push(job);
      }
    }
  }
  return { cwdPaths, jobs };
}

export function isServingWorktree(worktreePath, { cwdPaths = [], jobs = [] } = {}) {
  const canonical = (value) => {
    try { return fs.realpathSync(value); } catch { return path.resolve(value); }
  };
  const root = canonical(worktreePath);
  const within = (value) => {
    if (typeof value !== "string" || !path.isAbsolute(value)) return false;
    const relative = path.relative(root, canonical(value));
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  // Also recognize paths embedded in shell command arguments, with path boundaries.
  const roots = [...new Set([root, path.resolve(worktreePath)])];
  const argumentPointsHere = (argument) => typeof argument === "string" && (
    within(argument) || roots.some((value) => {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[\\s"'=])${escaped}(?=$|[/\\s"';])`).test(argument);
    })
  );
  return cwdPaths.some(within) || jobs.some((job) =>
    within(job.WorkingDirectory) || (Array.isArray(job.ProgramArguments) && job.ProgramArguments.some(argumentPointsHere)),
  );
}

export function classifyCleanWorktree(worktree, { integrated, servingState }) {
  if (isServingWorktree(worktree.path, servingState)) {
    return { level: "info", message: `active serving worktree retained: ${worktree.path}` };
  }
  return integrated
    ? { level: "errors", message: `clean integrated task worktree should be removed: ${worktree.path}` }
    : { level: "info", message: `clean unmerged task worktree retained: ${worktree.path}` };
}

export function isExemptWorktreePath(worktreePath, mainRoot) {
  return worktreePath === mainRoot || path.basename(worktreePath) === "grading-verify";
}

function decodeEnvValue(rawValue) {
  const value = rawValue.trim();
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnvDocument(text) {
  const assignments = new Map();
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    assignments.set(match[1], {
      index,
      rawLine: line,
      value: decodeEnvValue(match[2]),
    });
  });

  return { assignments, lines };
}

export function mergeEnvText(currentText, pulledText, { requiredKeys = [] } = {}) {
  const current = parseEnvDocument(currentText);
  const pulled = parseEnvDocument(pulledText);
  const lines = [...current.lines];
  const updated = [];
  const preserved = [];

  for (const [key, pulledEntry] of pulled.assignments) {
    const currentEntry = current.assignments.get(key);
    if (!pulledEntry.value && currentEntry?.value) {
      preserved.push(key);
      continue;
    }
    if (!pulledEntry.value) continue;

    if (currentEntry) {
      lines[currentEntry.index] = pulledEntry.rawLine;
    } else {
      while (lines.length > 0 && lines.at(-1) === "") lines.pop();
      lines.push(pulledEntry.rawLine, "");
    }
    updated.push(key);
  }

  const mergedText = lines.join("\n");
  const merged = parseEnvDocument(mergedText);
  const unresolved = requiredKeys.filter((key) => !merged.assignments.get(key)?.value);

  return { text: mergedText, preserved, updated, unresolved };
}

export function parseWorktreePorcelain(text) {
  const worktrees = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (!current || !line) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) current.branch = line.slice("branch ".length);
    else if (line === "detached") current.detached = true;
    else if (line.startsWith("prunable")) current.prunable = true;
  }
  if (current) worktrees.push(current);

  return worktrees.map((worktree) => ({
    ...worktree,
    path: path.resolve(worktree.path),
  }));
}

export function findIntegratedLocalBranches(
  branches,
  { attachedBranches = new Set(), protectedBranches = new Set(), targets = [], isAncestor },
) {
  const integrated = [];
  for (const branch of branches) {
    if (protectedBranches.has(branch) || attachedBranches.has(`refs/heads/${branch}`)) continue;
    const target = targets.find((reference) => isAncestor(branch, reference));
    if (target) integrated.push({ branch, target });
  }
  return integrated;
}
