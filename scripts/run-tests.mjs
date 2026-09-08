import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDirectory = path.join(root, "tests");
const testFiles = readdirSync(testsDirectory)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join("tests", name));

if (testFiles.length === 0) {
  console.error("Test dosyası bulunamadı.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
