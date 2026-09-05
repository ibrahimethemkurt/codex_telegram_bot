import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "../src/session-store.js";

test("persists Telegram-managed turn ids when loading an older session file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-gateway-session-"));
  const sessionFile = path.join(root, "sessions.json");
  try {
    await writeFile(
      sessionFile,
      JSON.stringify({ users: { "1": { currentProject: "demo", threads: { demo: "thread-1" } } } }),
      "utf8",
    );

    const store = new SessionStore(sessionFile);
    await store.load();
    assert.equal(store.isManagedTurn("turn-1"), false);
    await store.markManagedTurn("turn-1");
    assert.equal(store.isManagedTurn("turn-1"), true);

    const reloaded = new SessionStore(sessionFile);
    await reloaded.load();
    assert.equal(reloaded.isManagedTurn("turn-1"), true);
    const persisted = JSON.parse(await readFile(sessionFile, "utf8")) as { managedTurns: string[] };
    assert.deepEqual(persisted.managedTurns, ["turn-1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
