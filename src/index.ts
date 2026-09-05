import { appConfig } from "./config.js";
import { CodexAppServerClient } from "./app-server-client.js";
import { syncProjectRegistry, type ProjectSyncResult } from "./project-registry.js";
import { SessionStore } from "./session-store.js";
import { createTelegramBot } from "./telegram.js";
import { DesktopTurnMonitor } from "./desktop-turn-monitor.js";
import type { Project } from "./types.js";

async function main(): Promise<void> {
  const projects: Project[] = [];
  let syncInFlight: Promise<ProjectSyncResult> | null = null;
  const syncProjects = (): Promise<ProjectSyncResult> => {
    if (syncInFlight) {
      return syncInFlight;
    }
    syncInFlight = syncProjectRegistry(
      appConfig.projectsFile,
      appConfig.projectRoots,
      appConfig.projectScanMaxDepth,
      appConfig.projectAutoAddDepth,
      appConfig.excludedProjectPaths,
    ).then((result) => {
      projects.splice(0, projects.length, ...result.projects);
      if (result.added.length > 0) {
        console.log(`Yeni bulunan projeler: ${result.added.map((project) => project.name).join(", ")}`);
      }
      if (result.relocated.length > 0) {
        console.log(
          `Yeni konumu bulunan projeler: ${result.relocated
            .map((project) => `${project.name} → ${project.path}`)
            .join(", ")}`,
        );
      }
      if (result.missing.length > 0) {
        console.warn(
          `Atlanan erişilemeyen proje klasörleri:\n${result.missing
            .map((project) => `${project.name}: ${project.path}`)
            .join("\n")}`,
        );
      }
      return result;
    }).finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  };

  const initialSync = await syncProjects();
  if (initialSync.projects.length === 0) {
    throw new Error("Erişilebilen yerel proje klasörü bulunamadı.");
  }

  const sessions = new SessionStore(appConfig.sessionsFile);
  await sessions.load();

  const codex = new CodexAppServerClient(appConfig.codexBin, appConfig.codexModel);
  codex.on("log", (message: string) => console.log(`[codex] ${message}`));
  await codex.start();

  const bot = createTelegramBot({
    token: appConfig.telegramBotToken,
    allowedUserIds: appConfig.allowedUserIds,
    projects,
    sessions,
    codex,
    syncProjects,
  });

  const desktopMonitor = new DesktopTurnMonitor(
    codex,
    projects,
    sessions,
    appConfig.allowedUserIds,
    appConfig.desktopMonitorFile,
    appConfig.desktopMonitorIntervalMs,
    (chatId, text) => bot.api.sendMessage(chatId, text),
  );
  await desktopMonitor.start();

  const stop = async (signal: string): Promise<void> => {
    console.log(`${signal} alındı, gateway kapatılıyor...`);
    desktopMonitor.stop();
    await bot.stop();
    await codex.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  console.log(`${projects.length} yerel proje yüklendi.`);
  console.log("Telegram bot başlatılıyor...");
  await bot.start({ allowed_updates: ["message", "callback_query"] });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
