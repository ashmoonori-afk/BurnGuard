import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { materializeManagedTree, publishManagedTree } from "../src/services/artifact-tree-storage";
import { copyProjectIntoBundle } from "../src/services/export-handoff";
import { resolveStaticClosure } from "../src/services/export-closure";
import { shouldSkipPath } from "../src/services/watchers";
import { isPublicAsset } from "../src/services/vercel-publish";

test("Given uploaded originals, when publishing and restoring an older snapshot, then originals survive outside managed artifacts and exports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-document-boundaries-"));
  const project = path.join(root, "project");
  const snapshot = path.join(root, "snapshot");
  const stage = path.join(root, "stage");
  const bundle = path.join(root, "bundle");
  try {
    await mkdir(path.join(project, "docs"), { recursive: true });
    await writeFile(path.join(project, "docs/guide.html"), "<html><body>Original guide</body></html>");
    await materializeManagedTree(project, snapshot);
    await mkdir(path.join(project, "docs/attachments/empty"), { recursive: true });
    await writeFile(path.join(project, "docs/attachments/source.png"), "private original");
    const manifest = await materializeManagedTree(project, stage);
    expect(manifest.files.map((file) => file.path)).toEqual(["docs/guide.html"]);
    expect(await Bun.file(path.join(stage, "docs/attachments/source.png")).exists()).toBe(false);
    await writeFile(path.join(stage, "docs/guide.html"), "<html><body>Changed guide</body></html>");
    await publishManagedTree(stage, project);
    await publishManagedTree(snapshot, project);
    expect(await readFile(path.join(project, "docs/attachments/source.png"), "utf8")).toBe("private original");
    expect(await readFile(path.join(project, "docs/guide.html"), "utf8")).toContain("Original guide");
    await copyProjectIntoBundle(project, bundle);
    expect(await Bun.file(path.join(bundle, "docs/guide.html")).exists()).toBe(true);
    expect(await Bun.file(path.join(bundle, "docs/attachments/source.png")).exists()).toBe(false);
    expect(shouldSkipPath("docs/attachments/source.png")).toBe(true);
    expect(shouldSkipPath("docs/guide.html")).toBe(false);
    expect(isPublicAsset("docs/attachments/source.png")).toBe(false);
    expect(isPublicAsset("docs/guide.html")).toBe(true);
    await writeFile(path.join(project, "docs/guide.html"), '<html><body><img src="attachments/source.png"></body></html>');
    await expect(resolveStaticClosure(project, "docs/guide.html", await inspectCanonicalTree(project))).rejects.toMatchObject({ code: "missing_asset" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
