import path from "node:path";

const allowedTargets = new Set(["origin/master", "origin/staging"]);
const protectedBranches = new Set(["master", "staging"]);

export function parseFinishArgs(argv) {
  const options = {
    apply: false,
    branch: "",
    json: false,
    target: "origin/master",
  };

  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length);
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.branch) throw new Error("Provide exactly one branch name");
    else options.branch = arg;
  }

  if (!options.branch) throw new Error("Branch name is required");
  if (protectedBranches.has(options.branch)) {
    throw new Error(`Protected branch cannot be finished: ${options.branch}`);
  }
  if (!allowedTargets.has(options.target)) {
    throw new Error(`Target must be one of: ${[...allowedTargets].join(", ")}`);
  }

  return options;
}

export function isPathWithin(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function isManagedTaskWorktree(mainRoot, worktreePath) {
  return [
    path.join(mainRoot, ".codex-worktrees"),
    path.join(mainRoot, ".claude", "worktrees"),
  ].some((root) => isPathWithin(root, worktreePath));
}
