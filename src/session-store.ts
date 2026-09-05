import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const userSessionSchema = z.object({
  currentProject: z.string().nullable().default(null),
  threads: z.record(z.string(), z.string()).default({}),
});

const storeSchema = z.object({
  users: z.record(z.string(), userSessionSchema).default({}),
  managedTurns: z.array(z.string()).default([]),
});

type StoreData = z.infer<typeof storeSchema>;
type UserSession = z.infer<typeof userSessionSchema>;

const emptyStore = (): StoreData => ({ users: {}, managedTurns: [] });

export class SessionStore {
  private data: StoreData = emptyStore();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = storeSchema.parse(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.data = emptyStore();
    }
  }

  getUser(userId: number): UserSession {
    const key = String(userId);
    const existing = this.data.users[key];
    if (existing) {
      return existing;
    }

    const created: UserSession = { currentProject: null, threads: {} };
    this.data.users[key] = created;
    return created;
  }

  async setCurrentProject(userId: number, slug: string): Promise<void> {
    this.getUser(userId).currentProject = slug;
    await this.save();
  }

  async setThread(userId: number, projectSlug: string, threadId: string): Promise<void> {
    this.getUser(userId).threads[projectSlug] = threadId;
    await this.save();
  }

  async clearThread(userId: number, projectSlug: string): Promise<void> {
    delete this.getUser(userId).threads[projectSlug];
    await this.save();
  }

  isManagedThread(threadId: string): boolean {
    return Object.values(this.data.users).some((user) => Object.values(user.threads).includes(threadId));
  }

  async markManagedTurn(turnId: string): Promise<void> {
    if (this.data.managedTurns.includes(turnId)) {
      return;
    }
    this.data.managedTurns.push(turnId);
    if (this.data.managedTurns.length > 1000) {
      this.data.managedTurns.splice(0, this.data.managedTurns.length - 1000);
    }
    await this.save();
  }

  isManagedTurn(turnId: string): boolean {
    return this.data.managedTurns.includes(turnId);
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
