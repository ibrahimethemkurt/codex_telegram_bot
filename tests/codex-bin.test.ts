import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCodexBin } from "../src/codex-bin.js";

test("discovers the versioned Codex desktop executable on Windows", async () => {
  const localAppData = await mkdtemp(path.join(os.tmpdir(), "codex-bin-"));
  try {
    const executable = path.join(localAppData, "OpenAI", "Codex", "bin", "version-1", "codex.exe");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "", "utf8");

    assert.equal(resolveCodexBin("codex", { platform: "win32", localAppData }), executable);
  } finally {
    await rm(localAppData, { recursive: true, force: true });
  }
});

test("preserves an explicitly configured Codex executable", () => {
  const configured = "D:\\Tools\\codex-custom.exe";
  assert.equal(resolveCodexBin(configured, { platform: "win32", localAppData: "C:\\missing" }), configured);
});
