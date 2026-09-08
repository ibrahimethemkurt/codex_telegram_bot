import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverProjectDirectories, normalizePath } from "../src/project-discovery.js";
import { syncProjectRegistry } from "../src/project-registry.js";

test("discovers projects and skips generated/excluded directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-gateway-discovery-"));
  try {
    const gitProject = path.join(root, "GitProject");
    const nestedProject = path.join(root, "Group", "NodeProject");
    const dependencyProject = path.join(root, "node_modules", "FakeProject");
    const excludedProject = path.join(root, "Gateway");
    await mkdir(path.join(gitProject, ".git"), { recursive: true });
    await mkdir(nestedProject, { recursive: true });
    await writeFile(path.join(nestedProject, "package.json"), "{}", "utf8");
    await mkdir(dependencyProject, { recursive: true });
    await writeFile(path.join(dependencyProject, "package.json"), "{}", "utf8");
    await mkdir(excludedProject, { recursive: true });
    await writeFile(path.join(excludedProject, "package.json"), "{}", "utf8");

    const result = await discoverProjectDirectories([root], 4, [excludedProject]);
    const normalized = result.projectPaths.map(normalizePath);
    assert.deepEqual(normalized.sort(), [normalizePath(gitProject), normalizePath(nestedProject)].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync persists newly discovered projects and reports missing records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-gateway-sync-"));
  try {
    const project = path.join(root, "Yeni Proje");
    await mkdir(path.join(project, ".git"), { recursive: true });
    const registryFile = path.join(root, "projects.json");
    await writeFile(
      registryFile,
      `${JSON.stringify({
        projects: [{ slug: "missing", name: "Missing", path: path.join(root, "missing") }],
      })}\n`,
      "utf8",
    );

    const result = await syncProjectRegistry(registryFile, [root], 3, 1);
    assert.equal(result.added.length, 1);
    assert.equal(result.relocated.length, 0);
    assert.equal(result.added[0]?.name, "Yeni Proje");
    assert.equal(result.projects.length, 1);
    assert.equal(result.missing.length, 1);

    const persisted = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(registryFile, "utf8"))) as {
      projects: Array<{ path: string }>;
    };
    assert.ok(persisted.projects.some((item) => normalizePath(item.path) === normalizePath(project)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("first sync creates a local registry when projects.json does not exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-gateway-first-sync-"));
  try {
    const project = path.join(root, "FirstProject");
    await mkdir(path.join(project, ".git"), { recursive: true });
    const registryFile = path.join(root, "config", "projects.json");

    const result = await syncProjectRegistry(registryFile, [root], 2, 1);

    assert.equal(result.projects.length, 1);
    assert.equal(result.added[0]?.name, "FirstProject");
    const persisted = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(registryFile, "utf8"))) as {
      projects: Array<{ name: string }>;
    };
    assert.equal(persisted.projects[0]?.name, "FirstProject");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync relocates a uniquely matched missing project without adding nested projects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-gateway-relocate-"));
  try {
    const relocatedPath = path.join(root, "Archive", "MovedProject");
    await mkdir(path.join(relocatedPath, ".git"), { recursive: true });
    const registryFile = path.join(root, "projects.json");
    await writeFile(
      registryFile,
      `${JSON.stringify({
        projects: [{ slug: "moved", name: "MovedProject", path: path.join(root, "old", "MovedProject") }],
      })}\n`,
      "utf8",
    );

    const result = await syncProjectRegistry(registryFile, [root], 4, 1);
    assert.equal(result.relocated.length, 1);
    assert.equal(result.relocated[0]?.path, relocatedPath);
    assert.equal(result.added.length, 0);
    assert.equal(result.projects.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
