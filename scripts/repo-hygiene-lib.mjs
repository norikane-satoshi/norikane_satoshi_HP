import path from "node:path";

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
