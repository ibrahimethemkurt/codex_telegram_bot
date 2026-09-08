import { constants } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envExample = path.join(root, ".env.example");
const envFile = path.join(root, ".env");
const projectsFile = path.join(root, "config", "projects.json");

await mkdir(path.join(root, "config"), { recursive: true });
await mkdir(path.join(root, "data"), { recursive: true });

const envCreated = await createOnce(envFile, () => copyFile(envExample, envFile, constants.COPYFILE_EXCL));
const projectsCreated = await createOnce(projectsFile, () =>
  writeFile(projectsFile, `${JSON.stringify({ projects: [] }, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
);

console.log("\nCodex Telegram Gateway kurulumu hazırlandı.\n");
console.log(`${envCreated ? "✓" : "•"} .env ${envCreated ? "oluşturuldu" : "zaten vardı; değiştirilmedi"}`);
console.log(
  `${projectsCreated ? "✓" : "•"} config/projects.json ${projectsCreated ? "oluşturuldu" : "zaten vardı; değiştirilmedi"}`,
);
console.log("\nSıradaki adımlar:");
console.log("1. .env dosyasında TELEGRAM_BOT_TOKEN değerini doldurun.");
console.log("2. npm run dev çalıştırın ve botla özel sohbette /whoami yazın.");
console.log("3. Gelen sayısal ID'yi TELEGRAM_ALLOWED_USER_IDS alanına ekleyin.");
console.log("4. Gateway'i yeniden başlatın ve /projects yazın.");
console.log("\nKontrol için: npm run doctor\n");

async function createOnce(filePath: string, create: () => Promise<unknown>): Promise<boolean> {
  try {
    await create();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}
