import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexAppServerClient } from "./app-server-client.js";
import type { SessionStore } from "./session-store.js";
import type { Project, StoredThread, StoredThreadTurn, ThreadSummary } from "./types.js";

type MonitorState = {
  threads: Record<string, { turnId: string | null; updatedAt: number | null }>;
};

type SendMessage = (chatId: number, text: string) => Promise<unknown>;

export class DesktopTurnMonitor {
  private state: MonitorState = { threads: {} };
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly codex: CodexAppServerClient,
    private readonly projects: Project[],
    private readonly sessions: SessionStore,
    private readonly chatIds: Set<number>,
    private readonly stateFile: string,
    private readonly intervalMs: number,
    private readonly sendMessage: SendMessage,
  ) {}

  async start(): Promise<void> {
    await this.load();
    await this.poll(true);
    this.timer = setInterval(() => void this.poll(false), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(initializing: boolean): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const projectByPath = new Map(this.projects.map((project) => [normalizePath(project.path), project]));
      const threads = await this.codex.listRecentThreads(75);
      let changed = false;

      for (const summary of threads) {
        const project = summary.cwd ? projectByPath.get(normalizePath(summary.cwd)) : undefined;
        if (!project || this.sessions.isManagedThread(summary.id)) {
          continue;
        }

        const previous = this.state.threads[summary.id];
        if (previous && previous.updatedAt === (summary.updatedAt ?? null) && !isActiveThread(summary)) {
          continue;
        }

        let thread: StoredThread;
        try {
          thread = await this.codex.readThread(summary.id);
        } catch (error) {
          console.warn(`Masaüstü görevi okunamadı (${summary.id}):`, error);
          continue;
        }

        const turn = latestTerminalTurn(thread);
        const turnId = turn?.id ?? null;
        this.state.threads[summary.id] = { turnId, updatedAt: summary.updatedAt ?? null };
        changed = true;

        if (!initializing && turn && turn.id !== previous?.turnId) {
          await this.notify(project, summary, turn);
        }
      }

      if (changed) {
        await this.save();
      }
    } catch (error) {
      console.error("Masaüstü görev izleyicisi hatası:", error);
    } finally {
      this.polling = false;
    }
  }

  private async notify(project: Project, thread: ThreadSummary, turn: StoredThreadTurn): Promise<void> {
    const result = extractTurnResult(turn);
    const icon = turn.status === "completed" ? "✅" : turn.status === "interrupted" ? "⏹️" : "❌";
    const status = turn.status === "completed" ? "tamamlandı" : turn.status === "interrupted" ? "durduruldu" : "başarısız";
    const text = [
      `${icon} Codex görevi ${status}`,
      "",
      `Proje: ${project.name}`,
      `Görev: ${thread.name || thread.preview || "İsimsiz görev"}`,
      ...(result.input ? [`İstek: ${truncate(result.input, 500)}`] : []),
      "",
      truncate(result.output || turn.error?.message || "Codex görevi sonuç mesajı olmadan tamamlandı.", 3000),
    ].join("\n");

    for (const chatId of this.chatIds) {
      await this.sendMessage(chatId, text);
    }
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as MonitorState;
      this.state = parsed && parsed.threads ? parsed : { threads: {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Masaüstü izleyici durumu okunamadı, yeniden oluşturuluyor.");
      }
      this.state = { threads: {} };
    }
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.stateFile), { recursive: true });
    const temporaryPath = `${this.stateFile}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.stateFile);
  }
}

export function latestTerminalTurn(thread: StoredThread): StoredThreadTurn | undefined {
  return [...(thread.turns ?? [])]
    .reverse()
    .find((turn) => turn.status !== "inProgress" && typeof turn.completedAt === "number");
}

export function extractTurnResult(turn: StoredThreadTurn): { input?: string; output?: string } {
  const userMessages = turn.items.filter((item) => item.type === "userMessage");
  const agentMessages = turn.items.filter((item) => item.type === "agentMessage" && typeof item.text === "string");
  const input = userMessages
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "text" && typeof content.text === "string")
    .map((content) => content.text as string)
    .join("\n");
  const finalMessage = [...agentMessages].reverse().find((item) => item.phase === "final_answer") ?? agentMessages.at(-1);
  return {
    ...(input ? { input } : {}),
    ...(finalMessage?.text ? { output: finalMessage.text } : {}),
  };
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("tr-TR");
}

function isActiveThread(thread: ThreadSummary): boolean {
  return typeof thread.status === "string" ? thread.status === "active" : thread.status?.type === "active";
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
