import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SequencedEventEnvelope } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getExportJob } from "../src/db/exports";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { materializeManagedTree, publishManagedTree, readManagedFile } from "../src/services/artifact-tree-storage";
import { managedFileRoutes } from "../src/routes/managed-files";
import { sequencedBroker } from "../src/services/broker";
import { digestEntries, diskPathOf, inspectCanonicalTree, inspectCanonicalTreeOnDisk, type InspectedCanonicalTree } from "../src/services/canonical-tree-manifest";
import { enqueueProjectExport } from "../src/services/exports";

// A two-syllable Korean name: precomposed (NFC) and decomposed (NFD), as macOS tools, syncs and zips write it.
const NFC = "\uB85C\uACE0.svg";
const NFD = NFC.normalize("NFD");
const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"></svg>";
const HTML = "<!doctype html><html><head><title>NFD</title></head><body><main>NFD</main></body></html>";

const created: string[] = [];
const roots: string[] = [];

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-decomposed-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

async function createProject(kind: string, decomposeBeforeAdoption: boolean): Promise<{ readonly projectId: string; readonly sessionId: string }> {
  const projectId = `decomposed-${kind}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = `${projectId}-session`;
  const projectDir = path.join(projectsDir, projectId);
  const assets = path.join(projectDir, "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(projectDir, "index.html"), HTML);
  await writeFile(path.join(assets, decomposeBeforeAdoption ? NFD : NFC), SVG);
  const db = getSqlite();
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',NULL,1,1)").run(projectId, `Decomposed ${kind}`, projectDir);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  created.push(projectId);
  await new ArtifactCoordinator(db).initialize(projectId, projectDir);
  if (!decomposeBeforeAdoption) await rename(path.join(assets, NFC), path.join(assets, NFD));
  return { projectId, sessionId };
}

function terminalStatus(sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => { unsubscribe(); resolve("timeout"); }, 20_000);
    const unsubscribe = sequencedBroker.subscribe(sessionId, (item: SequencedEventEnvelope) => {
      if (item.event.type === "export.attempt" && ["failed", "cancelled", "validated"].includes(item.event.status)) {
        clearTimeout(deadline); unsubscribe(); resolve(item.event.status);
      }
    });
  });
}

async function exportOutcome(projectId: string, sessionId: string): Promise<{ readonly status: string; readonly error: string | null }> {
  const settled = terminalStatus(sessionId);
  const job = await enqueueProjectExport(projectId, "html_zip", {});
  const status = await settled;
  return { status, error: (await getExportJob(job!.id))?.error_message ?? null };
}

/** Entry names of a directory in their NFC form; the on-disk spelling itself depends on the file system. */
async function names(directory: string): Promise<readonly string[]> {
  return (await readdir(directory)).map((name) => name.normalize("NFC")).sort();
}

beforeAll(async () => { await runMigrations(); });

afterAll(async () => {
  for (const projectId of created) {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(path.join(projectsDir, projectId), { recursive: true, force: true });
  }
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("decomposed (NFD) file names in a managed tree", () => {
  test("Given a prototype with an NFD-normalized asset file name When an HTML export runs Then the export is validated", async () => {
    // Given: an initialized project whose asset name is then rewritten decomposed; the canonical digest is unchanged.
    const { projectId, sessionId } = await createProject("export", false);
    // When / Then
    expect(await exportOutcome(projectId, sessionId)).toEqual({ status: "validated", error: null });
  });

  test("Given a project folder that already holds an NFD-normalized asset name When it is adopted and exported Then both succeed", async () => {
    const { projectId, sessionId } = await createProject("adopt", true);
    expect(await exportOutcome(projectId, sessionId)).toEqual({ status: "validated", error: null });
  });

  test("Given a tree whose directory and file names are decomposed When it is materialized Then the copy holds the bytes under the NFC path", async () => {
    const directory = "\uC790\uC0B0";
    const source = await tree({ "index.html": HTML, [`${directory.normalize("NFD")}/${NFD}`]: SVG });
    const destination = path.join(await tree({}), "copy");
    // When
    const manifest = await materializeManagedTree(source, destination);
    // Then
    expect(manifest.files.map((file) => file.path)).toEqual(["index.html", `${directory}/${NFC}`]);
    expect(await readFile(path.join(destination, directory, NFC), "utf8")).toBe(SVG);
    expect(manifest.tree_digest).toBe((await inspectCanonicalTree(source)).tree_digest);
  });

  test("Given a live tree with a decomposed asset name When a staged tree is published over it Then the live tree holds that asset once", async () => {
    const live = await tree({ "index.html": HTML, [`assets/${NFD}`]: SVG });
    const stage = await tree({ "index.html": `${HTML}<!-- edited -->`, [`assets/${NFC}`]: SVG });
    // When
    const published = await publishManagedTree(stage, live);
    // Then: no second spelling of the same name is left next to the published one.
    expect(await names(path.join(live, "assets"))).toEqual([NFC]);
    expect(published.tree_digest).toBe((await inspectCanonicalTree(stage)).tree_digest);
    expect(await readFile(path.join(live, "index.html"), "utf8")).toBe(`${HTML}<!-- edited -->`);
  });

  test("Given a live tree with a decomposed asset name When the staged tree no longer has that asset Then publishing removes it", async () => {
    const live = await tree({ "index.html": HTML, [`assets/${NFD}`]: SVG, "assets/keep.svg": SVG });
    const stage = await tree({ "index.html": HTML, "assets/keep.svg": SVG });
    // When
    const published = await publishManagedTree(stage, live);
    // Then
    expect(await names(path.join(live, "assets"))).toEqual(["keep.svg"]);
    expect(published.files.map((file) => file.path)).toEqual(["assets/keep.svg", "index.html"]);
  });

  test("Given a staged tree in which the agent wrote a decomposed name When it is published Then the live tree holds the bytes under the NFC path", async () => {
    const live = await tree({ "index.html": HTML });
    const stage = await tree({ "index.html": HTML, [`assets/${NFD}`]: SVG });
    // When
    const published = await publishManagedTree(stage, live);
    // Then
    expect(published.files.map((file) => file.path)).toEqual([`assets/${NFC}`, "index.html"]);
    expect(await names(path.join(live, "assets"))).toEqual([NFC]);
    expect(await readFile(path.join(live, "assets", NFC), "utf8")).toBe(SVG);
  });

  test("Given a live directory with a decomposed name that also holds a skipped agent file When a staged tree is published Then one directory holds both", async () => {
    const directory = "\uC790\uC0B0";
    const live = await tree({ "index.html": HTML, [`${directory.normalize("NFD")}/AGENTS.md`]: "agent", [`${directory.normalize("NFD")}/${NFD}`]: SVG });
    const stage = await tree({ "index.html": HTML, [`${directory}/${NFC}`]: SVG });
    // When
    await publishManagedTree(stage, live);
    // Then: no second spelling of the directory is left beside the published one.
    expect(await names(live)).toEqual(["index.html", directory]);
    expect(await names(path.join(live, directory))).toEqual(["AGENTS.md", NFC]);
    expect(await readFile(path.join(live, directory, "AGENTS.md"), "utf8")).toBe("agent");
  });

  test("Given a live file with a decomposed name When it is read through its NFC manifest entry and the inspected disk paths Then its bytes are returned", async () => {
    const live = await tree({ "index.html": HTML, [`assets/${NFD}`]: SVG });
    const inspected = await inspectCanonicalTreeOnDisk(live);
    const entry = inspected.manifest.files.find((file) => file.path === `assets/${NFC}`);
    // When
    const bytes = await readManagedFile(live, entry!, {}, inspected.diskPaths);
    // Then
    expect(bytes.toString("utf8")).toBe(SVG);
  });

  test("Given a project whose asset name is decomposed on disk When the managed-files route serves its NFC path Then the asset is returned", async () => {
    const { projectId } = await createProject("serve", true);
    // When
    const response = await managedFileRoutes.request(`http://local/api/projects/${projectId}/fs/assets/${encodeURIComponent(NFC)}`);
    // Then
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SVG);
  });
});

describe("on-disk path of a manifest entry", () => {
  const inspected: InspectedCanonicalTree = {
    manifest: { schema_version: 1, digest_algorithm: "sha256", tree_digest: digestEntries([]), files: [], publication_state: "validated" },
    diskPaths: new Map([[`assets/${NFC}`, `assets/${NFD}`]]),
  };

  test("Given a Windows drive root When a decomposed entry is resolved Then the path uses backslashes and the on-disk spelling", () => {
    expect(diskPathOf("C:\\Users\\qa\\project", inspected, `assets/${NFC}`, path.win32)).toBe(`C:\\Users\\qa\\project\\assets\\${NFD}`);
  });

  test("Given a Windows UNC root When a decomposed entry is resolved Then the share prefix is kept", () => {
    expect(diskPathOf("\\\\server\\share\\project", inspected, `assets/${NFC}`, path.win32)).toBe(`\\\\server\\share\\project\\assets\\${NFD}`);
  });

  test("Given a Linux home root When a decomposed entry is resolved Then the path uses the on-disk spelling", () => {
    expect(diskPathOf("/home/qa/project", inspected, `assets/${NFC}`, path.posix)).toBe(`/home/qa/project/assets/${NFD}`);
  });

  test("Given a macOS home root When a decomposed entry is resolved Then the path uses the on-disk spelling", () => {
    expect(diskPathOf("/Users/qa/project", inspected, `assets/${NFC}`, path.posix)).toBe(`/Users/qa/project/assets/${NFD}`);
  });

  test("Given an entry whose on-disk name is already NFC When it is resolved Then its manifest path is used on both path flavors", () => {
    expect(diskPathOf("C:\\Users\\qa\\project", inspected, "assets/logo.svg", path.win32)).toBe("C:\\Users\\qa\\project\\assets\\logo.svg");
    expect(diskPathOf("/home/qa/project", inspected, "assets/logo.svg", path.posix)).toBe("/home/qa/project/assets/logo.svg");
  });
});
