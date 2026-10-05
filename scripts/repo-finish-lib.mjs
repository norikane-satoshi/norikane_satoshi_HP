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
    if (arg === "--") continue;
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

export function registeredTaskWorkspace(records, mainRoot, worktreePath, branch) {
  const matches = records.filter((record) =>
    path.resolve(record.path) === path.resolve(worktreePath) &&
    path.resolve(record.repository) === path.resolve(mainRoot) &&
    record.kind === "git-worktree" && record.branch === branch &&
    !["removed", "disposed", "tombstoned", "superseded"].includes(record.state),
  );
  if (matches.length !== 1 || !matches[0].workspace_id ||
      !matches[0].effective_owner_agent || !matches[0].effective_owner_task) {
    throw new Error(`Task worktree must have one exact lifecycle registration: ${worktreePath}`);
  }
  return matches[0];
}
