import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { resolveCodexBin } from "./codex-bin.js";

loadDotenv();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN boş bırakılamaz."),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),
  PROJECTS_FILE: z.string().default("./config/projects.json"),
  SESSIONS_FILE: z.string().default("./data/sessions.json"),
  DESKTOP_MONITOR_FILE: z.string().default("./data/desktop-monitor.json"),
  DESKTOP_MONITOR_INTERVAL_MS: z.coerce.number().int().min(2000).max(60000).default(5000),
  CODEX_BIN: z.string().default("codex"),
  CODEX_MODEL: z.string().default(""),
  PROJECT_ROOTS: z.string().default(""),
  PROJECT_SCAN_MAX_DEPTH: z.coerce.number().int().min(1).max(8).default(4),
  PROJECT_AUTO_ADD_DEPTH: z.coerce.number().int().min(1).max(4).default(1),
});

const parsed = envSchema.parse(process.env);

function resolveFromGateway(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function parseAllowedUserIds(value: string): Set<number> {
  const ids = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));

  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS yalnızca pozitif sayısal ID'ler içermelidir.");
  }

  return new Set(ids);
}

function parseProjectRoots(value: string): string[] {
  const configured = value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => path.resolve(part));

  if (configured.length > 0) {
    return configured;
  }

  return [path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "Documents", "ChatGPT")];
}

export const appConfig = {
  telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
  allowedUserIds: parseAllowedUserIds(parsed.TELEGRAM_ALLOWED_USER_IDS),
  projectsFile: resolveFromGateway(parsed.PROJECTS_FILE),
  sessionsFile: resolveFromGateway(parsed.SESSIONS_FILE),
  desktopMonitorFile: resolveFromGateway(parsed.DESKTOP_MONITOR_FILE),
  desktopMonitorIntervalMs: parsed.DESKTOP_MONITOR_INTERVAL_MS,
  codexBin: resolveCodexBin(parsed.CODEX_BIN),
  codexModel: parsed.CODEX_MODEL || undefined,
  projectRoots: parseProjectRoots(parsed.PROJECT_ROOTS),
  projectScanMaxDepth: parsed.PROJECT_SCAN_MAX_DEPTH,
  projectAutoAddDepth: parsed.PROJECT_AUTO_ADD_DEPTH,
  excludedProjectPaths: [process.cwd()],
};
