import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const forbiddenFiles = new Set([".env", "config/projects.json", "data/sessions.json", "data/desktop-monitor.json"]);
const patterns = [
  ["Telegram bot token", /\b\d{6,14}:[A-Za-z0-9_-]{25,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

const findings = [];
for (const relative of candidates) {
  const normalized = relative.replaceAll("\\", "/");
  if (forbiddenFiles.has(normalized)) {
    findings.push(`${normalized}: yerel/gizli dosya Git tarafından takip ediliyor`);
    continue;
  }
  const absolute = path.join(root, relative);
  if (statSync(absolute).size > 2_000_000) continue;
  let content;
  try {
    content = readFileSync(absolute, "utf8");
  } catch {
    continue;
  }
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${normalized}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error("Gizli bilgi güvenlik kontrolü başarısız:");
  for (const finding of findings) console.error(`- ${finding}`);
  console.error("Değerler güvenlik nedeniyle gösterilmedi.");
  process.exit(1);
}

console.log(`✓ Commit adayı ${candidates.length} dosyada gizli bilgi kalıbı bulunmadı.`);
