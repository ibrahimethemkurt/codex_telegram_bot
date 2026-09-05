import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { discoverProjectDirectories, normalizePath } from "./project-discovery.js";
import type { Project } from "./types.js";

const projectSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  path: z.string().min(1),
});

const registrySchema = z.object({
  projects: z.array(projectSchema).min(1),
});

export async function loadProjects(filePath: string): Promise<Project[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = registrySchema.parse(JSON.parse(raw));
  const seen = new Set<string>();

  return parsed.projects.map((project) => {
    if (seen.has(project.slug)) {
      throw new Error(`Tekrarlanan proje slug değeri: ${project.slug}`);
    }
    seen.add(project.slug);
    return { ...project, path: path.resolve(project.path) };
  });
}

export type ProjectSyncResult = {
  projects: Project[];
  added: Project[];
  relocated: Project[];
  missing: Project[];
  unavailableRoots: string[];
};

export async function syncProjectRegistry(
  filePath: string,
  roots: string[],
  maxDepth: number,
  autoAddDepth: number,
  excludedPaths: string[] = [],
): Promise<ProjectSyncResult> {
  const configured = await loadProjects(filePath);
  const accessibleConfigured: Project[] = [];
  for (const project of configured) {
    try {
      await access(project.path);
      accessibleConfigured.push(project);
    } catch {
      // Derin tarama aşağıda taşınmış projeyi adına göre bulmayı deneyecek.
    }
  }

  const discovery = await discoverProjectDirectories(
    roots,
    maxDepth,
    [...excludedPaths, ...accessibleConfigured.map((project) => project.path)],
  );
  const knownPaths = new Set(configured.map((project) => normalizePath(project.path)));
  const usedSlugs = new Set(configured.map((project) => project.slug));
  const added: Project[] = [];
  const relocated: Project[] = [];

  for (const project of configured.filter((item) => !accessibleConfigured.includes(item))) {
    const expectedNames = new Set([
      project.name.toLocaleLowerCase("tr-TR"),
      path.basename(project.path).toLocaleLowerCase("tr-TR"),
    ]);
    const matches = discovery.projectPaths.filter((candidate) =>
      expectedNames.has(path.basename(candidate).toLocaleLowerCase("tr-TR")),
    );
    if (matches.length === 1) {
      knownPaths.delete(normalizePath(project.path));
      project.path = matches[0]!;
      knownPaths.add(normalizePath(project.path));
      relocated.push(project);
    }
  }

  for (const discoveredPath of discovery.projectPaths) {
    if (knownPaths.has(normalizePath(discoveredPath)) || !isWithinAutoAddDepth(discoveredPath, roots, autoAddDepth)) {
      continue;
    }
    const name = path.basename(discoveredPath);
    const project: Project = {
      slug: uniqueSlug(name, usedSlugs),
      name,
      path: discoveredPath,
    };
    configured.push(project);
    added.push(project);
    knownPaths.add(normalizePath(discoveredPath));
    usedSlugs.add(project.slug);
  }

  if (added.length > 0 || relocated.length > 0) {
    await saveProjects(filePath, configured);
  }

  const projects: Project[] = [];
  const missing: Project[] = [];
  for (const project of configured) {
    try {
      await access(project.path);
      projects.push(project);
    } catch {
      missing.push(project);
    }
  }

  return { projects, added, relocated, missing, unavailableRoots: discovery.unavailableRoots };
}

export function findProject(projects: Project[], slug: string): Project | undefined {
  return projects.find((project) => project.slug === slug);
}

async function saveProjects(filePath: string, projects: Project[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ projects }, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function uniqueSlug(name: string, used: Set<string>): string {
  const normalized = name
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const base = normalized || "project";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 44)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function isWithinAutoAddDepth(candidate: string, roots: string[], maxDepth: number): boolean {
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return false;
    }
    return relative.split(path.sep).filter(Boolean).length <= maxDepth;
  });
}
