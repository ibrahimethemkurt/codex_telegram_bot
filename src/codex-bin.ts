import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

type ResolveCodexBinOptions = {
  platform?: NodeJS.Platform;
  localAppData?: string;
};

export function resolveCodexBin(
  configuredValue: string,
  options: ResolveCodexBinOptions = {},
): string {
  const configured = configuredValue.trim() || "codex";
  const normalized = configured.toLocaleLowerCase("en-US");
  const isDefaultCommand = normalized === "codex" || normalized === "codex.exe";
  const platform = options.platform ?? process.platform;

  if (!isDefaultCommand || platform !== "win32") {
    return configured;
  }

  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData) {
    return configured;
  }

  const binDirectories = [
    path.join(localAppData, "Programs", "OpenAI", "Codex", "bin"),
    path.join(localAppData, "OpenAI", "Codex", "bin"),
  ];
  const candidates: string[] = [];

  for (const binDirectory of binDirectories) {
    const directCandidate = path.join(binDirectory, "codex.exe");
    if (existsSync(directCandidate)) {
      candidates.push(directCandidate);
    }

    try {
      for (const entry of readdirSync(binDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const versionedCandidate = path.join(binDirectory, entry.name, "codex.exe");
        if (existsSync(versionedCandidate)) {
          candidates.push(versionedCandidate);
        }
      }
    } catch {
      // Bu kurulum yolu mevcut değilse sıradaki olası konuma bakılır.
    }
  }

  return candidates.sort((left, right) => modifiedAt(right) - modifiedAt(left))[0] ?? configured;
}

function modifiedAt(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}
