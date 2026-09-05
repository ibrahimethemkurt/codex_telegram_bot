import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { AccessMode, StoredThread, ThreadSummary, TurnResult } from "./types.js";

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type TurnWaiter = {
  resolve: (result: TurnResult) => void;
  reject: (reason: Error) => void;
};

export class CodexAppServerClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private requestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly loadedThreads = new Set<string>();
  private readonly turnWaiters = new Map<string, TurnWaiter>();
  private readonly turnText = new Map<string, string>();
  private readonly completedTurns = new Map<string, TurnResult>();

  constructor(
    private readonly codexBin: string,
    private readonly model?: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    this.process = spawn(this.codexBin, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.process.once("error", (error) => this.failAll(error));
    this.process.once("exit", (code, signal) => {
      this.failAll(new Error(`Codex App Server kapandı (code=${String(code)}, signal=${String(signal)}).`));
      this.process = null;
    });

    this.process.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        this.emit("log", message);
      }
    });

    const lines = createInterface({ input: this.process.stdout });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "codex_telegram_gateway",
        title: "Codex Telegram Gateway",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
  }

  async stop(): Promise<void> {
    this.process?.kill();
    this.process = null;
  }

  async listThreads(cwd: string): Promise<ThreadSummary[]> {
    const result = await this.request("thread/list", {
      limit: 10,
      sortKey: "updated_at",
      sortDirection: "desc",
      cwd,
      sourceKinds: [
        "cli",
        "vscode",
        "exec",
        "appServer",
        "subAgent",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "subAgentOther",
        "unknown",
      ],
    });

    return this.asObject(result).data as ThreadSummary[];
  }

  async listRecentThreads(limit = 50): Promise<ThreadSummary[]> {
    const result = await this.request("thread/list", {
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
    });
    return (this.asObject(result).data as ThreadSummary[]) ?? [];
  }

  async readThread(threadId: string): Promise<StoredThread> {
    const result = this.asObject(await this.request("thread/read", { threadId, includeTurns: true }));
    return this.asObject(result.thread) as StoredThread;
  }

  async startThread(cwd: string): Promise<string> {
    const params: JsonObject = {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "codex_telegram_gateway",
    };
    if (this.model) {
      params.model = this.model;
    }

    const result = this.asObject(await this.request("thread/start", params));
    const thread = this.asObject(result.thread);
    const threadId = thread.id;
    if (typeof threadId !== "string" || !threadId) {
      throw new Error("Codex yeni thread ID döndürmedi.");
    }
    this.loadedThreads.add(threadId);
    return threadId;
  }

  async forkThread(threadId: string, cwd: string): Promise<string> {
    const params: JsonObject = {
      threadId,
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: false,
    };
    if (this.model) {
      params.model = this.model;
    }

    const result = this.asObject(await this.request("thread/fork", params));
    const thread = this.asObject(result.thread);
    const forkedThreadId = thread.id;
    if (typeof forkedThreadId !== "string" || !forkedThreadId) {
      throw new Error("Codex çatallanan görev ID'si döndürmedi.");
    }
    this.loadedThreads.add(forkedThreadId);
    return forkedThreadId;
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.request("thread/name/set", { threadId, name });
  }

  async runTurn(
    threadId: string,
    cwd: string,
    prompt: string,
    mode: AccessMode,
    onStarted?: (turnId: string) => void,
  ): Promise<TurnResult> {
    if (!this.loadedThreads.has(threadId)) {
      await this.request("thread/resume", { threadId });
      this.loadedThreads.add(threadId);
    }

    const sandboxPolicy =
      mode === "workspaceWrite"
        ? {
            type: "workspaceWrite",
            writableRoots: [cwd],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          }
        : { type: "readOnly", networkAccess: false };

    const params: JsonObject = {
      threadId,
      input: [{ type: "text", text: prompt }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy,
    };
    if (this.model) {
      params.model = this.model;
    }

    const response = this.asObject(await this.request("turn/start", params));
    const turn = this.asObject(response.turn);
    const turnId = turn.id;
    if (typeof turnId !== "string" || !turnId) {
      throw new Error("Codex turn ID döndürmedi.");
    }

    onStarted?.(turnId);
    return this.waitForTurn(turnId);
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  private waitForTurn(turnId: string): Promise<TurnResult> {
    const completed = this.completedTurns.get(turnId);
    if (completed) {
      this.completedTurns.delete(turnId);
      return Promise.resolve(completed);
    }

    return new Promise<TurnResult>((resolve, reject) => {
      this.turnWaiters.set(turnId, { resolve, reject });
    });
  }

  private handleLine(line: string): void {
    let message: JsonObject;
    try {
      message = this.asObject(JSON.parse(line));
    } catch {
      this.emit("log", `Geçersiz App Server satırı: ${line}`);
      return;
    }

    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(this.errorMessage(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== "string") {
      return;
    }

    // Beklenmeyen yetki taleplerini güvenli biçimde reddet.
    if (typeof message.id === "number" && message.method.includes("requestApproval")) {
      this.write({ id: message.id, result: { decision: "decline" } });
      return;
    }

    const params = this.asObject(message.params);
    const turnId = typeof params.turnId === "string" ? params.turnId : undefined;

    if (message.method === "item/agentMessage/delta" && turnId) {
      const delta = typeof params.delta === "string" ? params.delta : "";
      this.turnText.set(turnId, `${this.turnText.get(turnId) ?? ""}${delta}`);
    }

    if (message.method === "item/completed" && turnId) {
      const item = this.asObject(params.item);
      if (item.type === "agentMessage" && typeof item.text === "string") {
        this.turnText.set(turnId, item.text);
      }
    }

    if (message.method === "turn/completed") {
      const turn = this.asObject(params.turn);
      const completedTurnId = typeof turn.id === "string" ? turn.id : turnId;
      if (!completedTurnId) {
        return;
      }
      const error = turn.error ? this.errorMessage(turn.error) : undefined;
      const result: TurnResult = {
        turnId: completedTurnId,
        status: typeof turn.status === "string" ? turn.status : "completed",
        text: this.turnText.get(completedTurnId) ?? "",
        ...(error ? { error } : {}),
      };
      this.turnText.delete(completedTurnId);
      const waiter = this.turnWaiters.get(completedTurnId);
      if (waiter) {
        this.turnWaiters.delete(completedTurnId);
        waiter.resolve(result);
      } else {
        this.completedTurns.set(completedTurnId, result);
      }
    }

    this.emit("notification", message);
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    const id = this.requestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ method, id, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  private notify(method: string, params: JsonObject): void {
    this.write({ method, params });
  }

  private write(message: JsonObject): void {
    if (!this.process?.stdin.writable) {
      throw new Error("Codex App Server çalışmıyor.");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.turnWaiters.values()) {
      waiter.reject(error);
    }
    this.turnWaiters.clear();
  }

  private asObject(value: unknown): JsonObject {
    return value && typeof value === "object" ? (value as JsonObject) : {};
  }

  private errorMessage(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    const object = this.asObject(value);
    return typeof object.message === "string" ? object.message : JSON.stringify(value);
  }
}
