import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { resolveCodexBin } from "./codex-bin.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
let failed = false;

console.log("\nCodex Telegram Gateway sistem kontrolü\n");

const nodeMajor = Number(process.versions.node.split(".")[0]);
report(nodeMajor >= 20, `Node.js ${process.versions.node}`, "Node.js 20 veya üstü gerekli.");

if (!existsSync(envPath)) {
  report(false, ".env bulundu", "Önce npm run setup çalıştırın.");
  finish();
}

const env = parse(readFileSync(envPath));
const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
report(/^\d{6,14}:[A-Za-z0-9_-]{25,}$/.test(token), "Telegram bot tokenı yapılandırılmış", "@BotFather tokenını .env dosyasına ekleyin.");

const rawIds = env.TELEGRAM_ALLOWED_USER_IDS?.trim() ?? "";
const idsValid = rawIds.length > 0 && rawIds.split(",").every((value) => /^\d+$/.test(value.trim()));
report(idsValid, "Telegram kullanıcı allowlist'i yapılandırılmış", "Botu ilk kez açıp /whoami yazın, sonra sayısal ID'yi .env dosyasına ekleyin.", true);

const codexBin = resolveCodexBin(env.CODEX_BIN?.trim() || "codex");
const codexResult = spawnSync(codexBin, ["--version"], { encoding: "utf8", windowsHide: true });
report(codexResult.status === 0, "Codex çalıştırıcısı bulundu", "Codex'i kurup giriş yapın veya CODEX_BIN için doğru yolu yazın.");

const configuredRoots = (env.PROJECT_ROOTS ?? "")
  .split(path.delimiter)
  .map((value) => value.trim())
  .filter(Boolean);
const roots = configuredRoots.length > 0
  ? configuredRoots
  : [path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "Documents")];
const existingRoots = roots.filter(existsSync);
report(existingRoots.length > 0, `${existingRoots.length}/${roots.length} proje tarama kökü erişilebilir`, "PROJECT_ROOTS değerini mevcut klasörlerle güncelleyin.");

const projectsPath = path.resolve(root, env.PROJECTS_FILE?.trim() || "./config/projects.json");
if (existsSync(projectsPath)) {
  try {
    const projects = JSON.parse(readFileSync(projectsPath, "utf8")) as { projects?: unknown[] };
    report(Array.isArray(projects.projects), "Yerel proje kayıt dosyası geçerli", "config/projects.json geçerli JSON içermeli.");
  } catch {
    report(false, "Yerel proje kayıt dosyası geçerli", "config/projects.json geçerli JSON içermeli.");
  }
} else {
  console.log("ℹ Proje kayıt dosyası ilk taramada otomatik oluşturulacak.");
}

finish();

function report(ok: boolean, success: string, failure: string, warning = false): void {
  if (ok) {
    console.log(`✓ ${success}`);
    return;
  }
  if (warning) {
    console.log(`! ${failure}`);
    return;
  }
  failed = true;
  console.log(`✗ ${failure}`);
}

function finish(): never {
  console.log(failed ? "\nKontrol başarısız. Yukarıdaki zorunlu maddeleri düzeltin.\n" : "\nSistem çalışmaya hazır.\n");
  process.exit(failed ? 1 : 0);
}
