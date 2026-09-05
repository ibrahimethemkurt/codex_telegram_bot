import { access, readdir } from "node:fs/promises";
import path from "node:path";

const PROJECT_MARKERS = new Set([
  ".git",
  ".codex",
  "agents.md",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "composer.json",
  "pom.xml",
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "output",
  "outputs",
  "target",
  "venv",
]);

export type DiscoveryResult = {
  projectPaths: string[];
  unavailableRoots: string[];
};

export async function discoverProjectDirectories(
  roots: string[],
  maxDepth: number,
  excludedPaths: string[] = [],
): Promise<DiscoveryResult> {
  const discovered = new Set<string>();
  const unavailableRoots: string[] = [];
  const excluded = new Set(excludedPaths.map(normalizePath));

  for (const configuredRoot of roots) {
    const root = path.resolve(configuredRoot);
    try {
      await access(root);
    } catch {
      unavailableRoots.push(root);
      continue;
    }
    await walk(root, 0, maxDepth, excluded, discovered);
  }

  return {
    projectPaths: [...discovered].sort((left, right) => left.localeCompare(right, "tr")),
    unavailableRoots,
  };
}

async function walk(
  currentPath: string,
  depth: number,
  maxDepth: number,
  excluded: Set<string>,
  discovered: Set<string>,
): Promise<void> {
  if (excluded.has(normalizePath(currentPath))) {
    return;
  }

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  const names = new Set(entries.map((entry) => entry.name.toLocaleLowerCase("en-US")));
  if (depth > 0 && isProjectDirectory(names)) {
    discovered.add(path.resolve(currentPath));
    return;
  }

  if (depth >= maxDepth) {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const lowerName = entry.name.toLocaleLowerCase("en-US");
    if (EXCLUDED_DIRECTORY_NAMES.has(lowerName) || entry.name.startsWith(".")) {
      continue;
    }
    await walk(path.join(currentPath, entry.name), depth + 1, maxDepth, excluded, discovered);
  }
}

function isProjectDirectory(names: Set<string>): boolean {
  if ([...names].some((name) => name.endsWith(".sln"))) {
    return true;
  }
  return [...PROJECT_MARKERS].some((marker) => names.has(marker));
}

export function normalizePath(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
