import { Bot, InlineKeyboard, type Context } from "grammy";
import type { CodexAppServerClient } from "./app-server-client.js";
import { findProject, type ProjectSyncResult } from "./project-registry.js";
import type { SessionStore } from "./session-store.js";
import type { AccessMode, Project } from "./types.js";

type ActiveTurn = {
  threadId: string;
  turnId: string;
};

type ProjectActivity = {
  state: "running" | "completed" | "interrupted" | "failed";
  mode: AccessMode;
  prompt: string;
  startedAt: number;
  finishedAt?: number;
  threadId?: string;
  turnId?: string;
};

type BotDependencies = {
  token: string;
  allowedUserIds: Set<number>;
  projects: Project[];
  sessions: SessionStore;
  codex: CodexAppServerClient;
  syncProjects: () => Promise<ProjectSyncResult>;
};

const TELEGRAM_CHUNK_SIZE = 3800;

export function createTelegramBot(deps: BotDependencies): Bot {
  const bot = new Bot(deps.token);
  const busyProjects = new Set<string>();
  const activeTurns = new Map<string, ActiveTurn>();
  const projectActivities = new Map<string, ProjectActivity>();

  bot.command("whoami", async (ctx) => {
    const id = ctx.from?.id;
    await ctx.reply(id ? `Telegram kullanıcı ID'n: ${id}` : "Kullanıcı ID bulunamadı.");
  });

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !deps.allowedUserIds.has(userId)) {
      await ctx.reply(
        deps.allowedUserIds.size === 0
          ? "Gateway henüz kilitli. /whoami yaz, çıkan ID'yi .env içindeki TELEGRAM_ALLOWED_USER_IDS alanına ekle."
          : "Bu botu kullanma yetkin yok. Kendi ID'ni görmek için /whoami yazabilirsin.",
      );
      return;
    }
    await next();
  });

  bot.command("start", (ctx) => ctx.reply(helpText()));
  bot.command("help", (ctx) => ctx.reply(helpText()));
  bot.command("ping", (ctx) => ctx.reply("🟢 Bot çalışıyor ve komut almaya hazır."));

  bot.command("projects", async (ctx) => {
    const progress = await ctx.reply("⏳ Projeler taranıyor...");
    const syncResult = await deps.syncProjects();
    const userId = requireUserId(ctx);
    const current = deps.sessions.getUser(userId).currentProject;
    const keyboard = new InlineKeyboard();
    for (const project of deps.projects) {
      keyboard.text(`${current === project.slug ? "✅ " : ""}${project.name}`, `project:${project.slug}`).row();
    }
    const discoveryNote =
      syncResult.added.length > 0 ? `\n${syncResult.added.length} yeni proje otomatik eklendi.` : "";
    await ctx.api.editMessageText(ctx.chat!.id, progress.message_id, `Bir proje seç:${discoveryNote}`, {
      reply_markup: keyboard,
    });
  });

  bot.command("sync", async (ctx) => {
    const progress = await ctx.reply("⏳ Yeni projeler aranıyor...");
    const result = await deps.syncProjects();
    const addedNames = result.added.map((project) => `• ${project.name}`).join("\n");
    const lines = [
      `✅ Proje taraması tamamlandı.`,
      `Kullanılabilir proje: ${result.projects.length}`,
      `Yeni bulunan: ${result.added.length}`,
      `Yeni konuma bağlanan: ${result.relocated.length}`,
      `Klasörü bulunamayan eski kayıt: ${result.missing.length}`,
      `Erişilemeyen tarama kökü: ${result.unavailableRoots.length}`,
    ];
    if (addedNames) {
      lines.push("", "Eklenen projeler:", addedNames);
    }
    if (result.relocated.length > 0) {
      lines.push(
        "",
        "Yeni konumu bulunan projeler:",
        ...result.relocated.map((project) => `• ${project.name} → ${project.path}`),
      );
    }
    await ctx.api.editMessageText(ctx.chat!.id, progress.message_id, lines.join("\n"));
  });

  bot.callbackQuery(/^project:(.+)$/, async (ctx) => {
    const userId = requireUserId(ctx);
    const slug = ctx.match[1] ?? "";
    const project = findProject(deps.projects, slug);
    if (!project) {
      await ctx.answerCallbackQuery({ text: "Proje bulunamadı." });
      return;
    }
    await deps.sessions.setCurrentProject(userId, project.slug);
    const latestThread = (await deps.codex.listThreads(project.path))[0];
    if (latestThread) {
      await deps.sessions.setThread(userId, project.slug, latestThread.id);
    }
    await ctx.answerCallbackQuery({ text: `${project.name} seçildi.` });
    const threadNote = latestThread
      ? `\n\nBağlı Codex görevi: ${threadTitle(latestThread)}`
      : "\n\nBu projede mevcut görev yok; ilk komutta yenisi açılacak.";
    await ctx.editMessageText(`Aktif proje: ${project.name}\n${project.path}${threadNote}`);
  });

  bot.command("use", async (ctx) => {
    const userId = requireUserId(ctx);
    const slug = String(ctx.match ?? "").trim();
    const project = findProject(deps.projects, slug);
    if (!project) {
      await ctx.reply("Proje bulunamadı. /projects ile listeyi aç.");
      return;
    }
    await deps.sessions.setCurrentProject(userId, project.slug);
    await ctx.reply(`Aktif proje: ${project.name}`);
  });

  bot.command("current", async (ctx) => {
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.reply("Henüz proje seçilmedi. /projects yaz.");
      return;
    }
    const progress = await ctx.reply("⏳ Aktif proje bilgisi okunuyor...");
    const userId = requireUserId(ctx);
    const selectedThreadId = deps.sessions.getUser(userId).threads[project.slug];
    const selectedThread = selectedThreadId
      ? (await deps.codex.listThreads(project.path)).find((thread) => thread.id === selectedThreadId)
      : undefined;
    const threadLine = selectedThread
      ? `\nBağlı görev: ${threadTitle(selectedThread)}`
      : selectedThreadId
        ? `\nBağlı görev: ${selectedThreadId}`
        : "\nBağlı görev yok.";
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progress.message_id,
      `Aktif proje: ${project.name}\n${project.path}${threadLine}`,
    );
  });

  bot.command("threads", async (ctx) => {
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.reply("Önce /projects ile proje seç.");
      return;
    }
    const progress = await ctx.reply("⏳ Codex görevleri okunuyor...");
    const threads = await deps.codex.listThreads(project.path);
    if (threads.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progress.message_id,
        "Bu proje için kayıtlı Codex görevi bulunamadı.",
      );
      return;
    }
    const userId = requireUserId(ctx);
    const selectedThreadId = deps.sessions.getUser(userId).threads[project.slug];
    const keyboard = new InlineKeyboard();
    for (const thread of threads.slice(0, 8)) {
      const selected = thread.id === selectedThreadId ? "✅ " : "";
      const active = isActiveThread(thread) ? "🟢 " : "";
      keyboard.text(`${selected}${active}${truncate(threadTitle(thread), 42)}`, `thread:${thread.id}`).row();
    }
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progress.message_id,
      "Devam etmek istediğin Codex görevini seç:\n🟢 açık görev seçilirse geçmişi korunarak Telegram için bir dal açılır.",
      { reply_markup: keyboard },
    );
  });

  bot.callbackQuery(/^thread:(.+)$/, async (ctx) => {
    const userId = requireUserId(ctx);
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.answerCallbackQuery({ text: "Önce proje seç." });
      return;
    }
    const threadId = ctx.match[1] ?? "";
    const thread = (await deps.codex.listThreads(project.path)).find((item) => item.id === threadId);
    if (!thread) {
      await ctx.answerCallbackQuery({ text: "Görev artık bulunamıyor." });
      return;
    }
    await deps.sessions.setThread(userId, project.slug, thread.id);
    await ctx.answerCallbackQuery({ text: "Codex görevine bağlandı." });
    const activeNote = isActiveThread(thread)
      ? "\nBu görev bilgisayarda açık; ilk komutta geçmişinden yeni bir Telegram dalı açılacak."
      : "";
    await ctx.editMessageText(`Bağlı görev: ${threadTitle(thread)}\n${thread.id}${activeNote}`);
  });

  bot.command("latest", async (ctx) => {
    const userId = requireUserId(ctx);
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.reply("Önce /projects ile proje seç.");
      return;
    }
    const progress = await ctx.reply("⏳ En son Codex görevi aranıyor...");
    const latest = (await deps.codex.listThreads(project.path))[0];
    if (!latest) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progress.message_id,
        "Bu projede bağlanılacak Codex görevi yok. /new ile oluşturabilirsin.",
      );
      return;
    }
    await deps.sessions.setThread(userId, project.slug, latest.id);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progress.message_id,
      `En son Codex görevine bağlandım:\n${threadTitle(latest)}\n${latest.id}`,
    );
  });

  bot.command("new", async (ctx) => {
    const userId = requireUserId(ctx);
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.reply("Önce /projects ile proje seç.");
      return;
    }
    const progress = await ctx.reply("⏳ Yeni Codex görevi hazırlanıyor...");
    const threadId = await deps.codex.startThread(project.path);
    await deps.sessions.setThread(userId, project.slug, threadId);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progress.message_id,
      `✅ Yeni Codex görevi hazır.\nProje: ${project.name}\nThread: ${threadId}`,
    );
  });

  bot.command("ask", (ctx) => {
    launchPrompt(ctx, String(ctx.match ?? "").trim(), "readOnly");
  });

  bot.command("do", (ctx) => {
    launchPrompt(ctx, String(ctx.match ?? "").trim(), "workspaceWrite");
  });

  bot.command("status", async (ctx) => {
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.reply("Önce /projects ile proje seç.");
      return;
    }
    const activity = projectActivities.get(project.slug);
    if (busyProjects.has(project.slug) && activity?.state === "running") {
      const taskLines = activity.threadId
        ? [`Codex görevi: ${activity.threadId}`, activity.turnId ? `Aktif tur: ${activity.turnId}` : "Aşama: tur hazırlanıyor"]
        : ["Aşama: Codex görevi hazırlanıyor"];
      await ctx.reply(
        [
          "🟠 Codex çalışıyor",
          `Proje: ${project.name}`,
          `İşlem: ${activity.mode === "workspaceWrite" ? "değişiklik yapılıyor" : "proje inceleniyor"}`,
          `Süre: ${formatElapsed(activity.startedAt)}`,
          ...taskLines,
          `İstek: ${truncate(activity.prompt, 500)}`,
        ].join("\n"),
      );
      return;
    }

    const progress = await ctx.reply("⏳ Codex durumu kontrol ediliyor...");
    const activeDesktopThread = (await deps.codex.listThreads(project.path)).find(isActiveThread);
    const lastActivity = activity
      ? `\nSon Telegram görevi: ${activityLabel(activity.state)}\nİstek: ${truncate(activity.prompt, 300)}`
      : "";
    const text = activeDesktopThread
      ? `🟡 Bot boşta; bilgisayarda açık veya çalışan bir Codex görevi var.\nProje: ${project.name}\nGörev: ${threadTitle(activeDesktopThread)}${lastActivity}`
      : `⚪ Codex botu bu projede şu an boşta.\nProje: ${project.name}${lastActivity}`;
    await ctx.api.editMessageText(ctx.chat!.id, progress.message_id, text);
  });

  bot.command("stop", async (ctx) => {
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.reply("Önce /projects ile proje seç.");
      return;
    }
    const active = activeTurns.get(project.slug);
    if (!active) {
      await ctx.reply("Durdurulacak aktif görev yok.");
      return;
    }
    await deps.codex.interrupt(active.threadId, active.turnId);
    await ctx.reply("Durdurma isteği gönderildi.");
  });

  bot.on("message:text", (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      return;
    }
    launchPrompt(ctx, ctx.message.text, "readOnly");
  });

  bot.on("edited_message:text", async (ctx) => {
    const editedText = ctx.update.edited_message.text;
    if (editedText.startsWith("/")) {
      await ctx.reply(
        "⚠️ Düzenlenmiş komut güvenlik için yeniden çalıştırılmadı. Komutu yeni bir mesaj olarak tekrar gönder.",
      );
    }
  });

  bot.catch(async ({ ctx, error }) => {
    console.error("Telegram bot hatası:", error);
    try {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ Komut tamamlanamadı: ${truncate(message, 700)}`);
    } catch {
      // Telegram'a hata cevabı da gönderilemiyorsa yalnızca sunucu kaydı kalır.
    }
  });

  function launchPrompt(ctx: Context, prompt: string, mode: AccessMode): void {
    // Uzun Codex turunu Telegram update işleyicisinden ayır. Böylece aynı tur
    // sürerken /status ve /stop gibi yeni komutlar hemen işlenebilir.
    void runPrompt(ctx, prompt, mode).catch(async (error) => {
      console.error("Arka plan Telegram görevi başlatılamadı:", error);
      try {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.reply(`❌ Komut başlatılamadı: ${truncate(message, 700)}`);
      } catch {
        // Telegram'a hata cevabı da gönderilemiyorsa yalnızca sunucu kaydı kalır.
      }
    });
  }

  async function runPrompt(ctx: Context, prompt: string, mode: AccessMode): Promise<void> {
    if (!prompt) {
      await ctx.reply(mode === "readOnly" ? "Kullanım: /ask <soru>" : "Kullanım: /do <talimat>");
      return;
    }

    const userId = requireUserId(ctx);
    const project = currentProject(ctx, deps);
    if (!project) {
      await ctx.reply("Önce /projects ile proje seç.");
      return;
    }
    if (busyProjects.has(project.slug)) {
      await ctx.reply("Bu projede zaten bir görev çalışıyor. /status veya /stop kullan.");
      return;
    }

    busyProjects.add(project.slug);
    const activity: ProjectActivity = {
      state: "running",
      mode,
      prompt,
      startedAt: Date.now(),
    };
    projectActivities.set(project.slug, activity);
    const statusMessage = await ctx.reply(
      mode === "readOnly"
        ? `🔎 Komut alındı. ${project.name} inceleniyor...\nDurumu görmek için /status yaz.`
        : `🛠️ Komut alındı. ${project.name} üzerinde çalışılıyor...\nDurumu görmek için /status yaz.`,
    );

    try {
      let threadId = deps.sessions.getUser(userId).threads[project.slug];
      if (!threadId) {
        const latestThread = (await deps.codex.listThreads(project.path))[0];
        threadId = latestThread?.id ?? (await deps.codex.startThread(project.path));
        await deps.sessions.setThread(userId, project.slug, threadId);
      }
      activity.threadId = threadId;

      let forkedFromActive = false;
      let result;
      try {
        const activeThreadId = threadId;
        result = await deps.codex.runTurn(activeThreadId, project.path, prompt, mode, (turnId) => {
          activity.turnId = turnId;
          activeTurns.set(project.slug, { threadId: activeThreadId, turnId });
          void deps.sessions.markManagedTurn(turnId).catch((error) => {
            console.error("Telegram turu kaydedilemedi:", error);
          });
        });
      } catch (error) {
        if (!isActiveWriterError(error)) {
          throw error;
        }
        const originalThreadId = threadId;
        threadId = await deps.codex.forkThread(originalThreadId, project.path);
        await deps.codex.setThreadName(threadId, telegramThreadName(prompt));
        await deps.sessions.setThread(userId, project.slug, threadId);
        activity.threadId = threadId;
        delete activity.turnId;
        forkedFromActive = true;
        const activeThreadId = threadId;
        result = await deps.codex.runTurn(activeThreadId, project.path, prompt, mode, (turnId) => {
          activity.turnId = turnId;
          activeTurns.set(project.slug, { threadId: activeThreadId, turnId });
          void deps.sessions.markManagedTurn(turnId).catch((error) => {
            console.error("Telegram turu kaydedilemedi:", error);
          });
        });
      }
      const resultText = result.text || result.error || `Görev ${result.status} durumuyla tamamlandı.`;
      activity.state =
        result.status === "completed" ? "completed" : result.status === "interrupted" ? "interrupted" : "failed";
      activity.finishedAt = Date.now();
      const answer = forkedFromActive
        ? `🔀 Bilgisayarda açık görev meşgul olduğu için geçmişi korunarak yeni bir Telegram dalında çalıştırıldı.\n\n${resultText}`
        : resultText;
      await editThenSendRest(ctx, statusMessage.message_id, answer);
    } catch (error) {
      activity.state = "failed";
      activity.finishedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      await ctx.api.editMessageText(ctx.chat!.id, statusMessage.message_id, `❌ Hata: ${message}`);
    } finally {
      busyProjects.delete(project.slug);
      activeTurns.delete(project.slug);
    }
  }

  return bot;
}

function requireUserId(ctx: Context): number {
  const id = ctx.from?.id;
  if (!id) {
    throw new Error("Telegram kullanıcı ID bulunamadı.");
  }
  return id;
}

function currentProject(ctx: Context, deps: BotDependencies): Project | undefined {
  const userId = requireUserId(ctx);
  const slug = deps.sessions.getUser(userId).currentProject;
  return slug ? findProject(deps.projects, slug) : undefined;
}

function helpText(): string {
  return [
    "Codex Telegram Gateway",
    "",
    "/projects — proje seç",
    "/ping — botun çalıştığını kontrol et",
    "/sync — yeni projeleri tara",
    "/current — aktif projeyi göster",
    "/threads — mevcut Codex görevini seç",
    "/latest — en son Codex görevine bağlan",
    "/new — yeni Codex görevi başlat",
    "/ask <soru> — salt okunur soru sor",
    "/do <talimat> — seçili projede değişiklik yap",
    "/status — görev durumunu göster",
    "/stop — aktif görevi durdur",
    "/whoami — Telegram kullanıcı ID'ni göster",
    "",
    "Komutsuz normal mesajlar /ask olarak çalışır.",
  ].join("\n");
}

async function sendLong(ctx: Context, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) {
    await ctx.reply(chunk);
  }
}

async function editThenSendRest(ctx: Context, messageId: number, text: string): Promise<void> {
  const chunks = splitMessage(text);
  const first = chunks.shift() ?? "Tamamlandı.";
  await ctx.api.editMessageText(ctx.chat!.id, messageId, first);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > TELEGRAM_CHUNK_SIZE) {
    let cut = remaining.lastIndexOf("\n", TELEGRAM_CHUNK_SIZE);
    if (cut < TELEGRAM_CHUNK_SIZE / 2) {
      cut = TELEGRAM_CHUNK_SIZE;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.length > 0 ? chunks : ["Boş yanıt döndü."];
}

function threadTitle(thread: { name?: string | null; preview?: string }): string {
  return thread.name || thread.preview || "İsimsiz görev";
}

function isActiveThread(thread: { status?: string | { type?: string } }): boolean {
  return typeof thread.status === "string" ? thread.status === "active" : thread.status?.type === "active";
}

function isActiveWriterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("active writer");
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function telegramThreadName(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || "Yeni görev";
  return `Telegram · ${truncate(firstLine, 70)}`;
}

function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} dk ${seconds} sn` : `${seconds} sn`;
}

function activityLabel(state: ProjectActivity["state"]): string {
  if (state === "completed") return "✅ tamamlandı";
  if (state === "interrupted") return "⏹️ durduruldu";
  if (state === "failed") return "❌ başarısız";
  return "🟠 çalışıyor";
}
