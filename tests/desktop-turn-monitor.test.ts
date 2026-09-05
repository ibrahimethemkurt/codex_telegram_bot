import assert from "node:assert/strict";
import test from "node:test";
import { extractTurnResult, latestTerminalTurn } from "../src/desktop-turn-monitor.js";
import type { StoredThread } from "../src/types.js";

test("extracts latest completed turn input and final answer", () => {
  const thread: StoredThread = {
    id: "thread-1",
    turns: [
      { id: "turn-1", status: "completed", items: [] },
      {
        id: "turn-2",
        status: "completed",
        items: [
          { type: "userMessage", content: [{ type: "text", text: "Projeyi raporla" }] },
          { type: "agentMessage", phase: "commentary", text: "İnceliyorum" },
          { type: "agentMessage", phase: "final_answer", text: "Rapor hazır" },
        ],
      },
    ],
  };

  const turn = latestTerminalTurn(thread);
  assert.equal(turn?.id, "turn-2");
  assert.deepEqual(extractTurnResult(turn!), { input: "Projeyi raporla", output: "Rapor hazır" });
});
