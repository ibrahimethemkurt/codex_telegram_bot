import assert from "node:assert/strict";
import test from "node:test";
import type { ApiResponse, Update } from "grammy/types";
import type { CodexAppServerClient } from "../src/app-server-client.js";
import type { SessionStore } from "../src/session-store.js";
import { createTelegramBot } from "../src/telegram.js";
import type { TurnResult } from "../src/types.js";

const USER_ID = 123;
const PROJECT = { slug: "demo", name: "Demo", path: "C:\\Demo" };

test("status responds while a detached do task is still running", async () => {
  let resolveTurn!: (result: TurnResult) => void;
  let markTurnStarted!: () => void;
  const turnStarted = new Promise<void>((resolve) => {
    markTurnStarted = resolve;
  });
  const runningTurn = new Promise<TurnResult>((resolve) => {
    resolveTurn = resolve;
  });

  const sessions = {
    getUser: () => ({ currentProject: PROJECT.slug, threads: { [PROJECT.slug]: "thread-1" } }),
    setThread: async () => undefined,
    markManagedTurn: async () => undefined,
  } as unknown as SessionStore;
  const codex = {
    runTurn: async (
      _threadId: string,
      _cwd: string,
      _prompt: string,
      _mode: string,
      onStarted?: (turnId: string) => void,
    ) => {
      onStarted?.("turn-1");
      markTurnStarted();
      return runningTurn;
    },
  } as unknown as CodexAppServerClient;

  const bot = createTelegramBot({
    token: "123:test",
    allowedUserIds: new Set([USER_ID]),
    projects: [PROJECT],
    sessions,
    codex,
    syncProjects: async () => ({
      projects: [PROJECT],
      added: [],
      relocated: [],
      missing: [],
      unavailableRoots: [],
    }),
  });

  const sentTexts: string[] = [];
  let nextMessageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "getMe") {
      return {
        ok: true,
        result: {
          id: 123,
          is_bot: true,
          first_name: "Test Bot",
          username: "test_bot",
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
          can_connect_to_business: false,
          has_main_web_app: false,
        },
      } as ApiResponse;
    }
    if (method === "sendMessage") {
      const text = String((payload as { text?: string }).text ?? "");
      sentTexts.push(text);
      return {
        ok: true,
        result: {
          message_id: nextMessageId++,
          date: 1,
          chat: { id: USER_ID, type: "private" },
          text,
        },
      } as ApiResponse;
    }
    return { ok: true, result: true } as ApiResponse;
  });
  await bot.init();

  await bot.handleUpdate(commandUpdate(1, "/do düzelt"));
  await turnStarted;

  await Promise.race([
    bot.handleUpdate(commandUpdate(2, "/status")),
    new Promise((_, reject) => setTimeout(() => reject(new Error("/status uzun görev yüzünden bloke oldu")), 250)),
  ]);

  const status = sentTexts.find((text) => text.startsWith("🟠 Codex çalışıyor"));
  assert.ok(status);
  assert.match(status, /Codex görevi: thread-1/);
  assert.match(status, /Aktif tur: turn-1/);
  assert.match(status, /İstek: düzelt/);

  resolveTurn({ turnId: "turn-1", status: "completed", text: "Tamamlandı" });
  await new Promise((resolve) => setImmediate(resolve));
});

function commandUpdate(updateId: number, text: string): Update {
  const command = text.split(" ", 1)[0] ?? text;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat: { id: USER_ID, type: "private" },
      from: { id: USER_ID, is_bot: false, first_name: "Test" },
      text,
      entities: [{ offset: 0, length: command.length, type: "bot_command" }],
    },
  };
}
