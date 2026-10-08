import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultManagedTreeIo, materializeManagedTree, publishManagedTree, type ManagedTreeIo } from "../src/services/artifact-tree-storage";

const roots: string[] = [];

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-durability-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

function recordingIo(events: string[]): ManagedTreeIo {
  return {
    syncFile: async (handle) => { events.push("sync-file"); await defaultManagedTreeIo.syncFile(handle); },
    rename: async (from, to) => { events.push(`rename:${path.basename(to)}`); await defaultManagedTreeIo.rename(from, to); },
    syncDirectory: async (directory) => { events.push("sync-dir"); await defaultManagedTreeIo.syncDirectory(directory); },
  };
}

afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

describe("managed tree durability", () => {
  test("Given a publication, When files are written, Then each file is synced before its rename and directories are synced afterwards", async () => {
    const source = await tree({ "index.html": "<p>a</p>", "css/site.css": "p{}" });
    const destination = await tree({});
    const events: string[] = [];
    await publishManagedTree(source, destination, undefined, {}, recordingIo(events));
    for (const name of ["index.html", "site.css"]) {
      const rename = events.indexOf(`rename:${name}`);
      expect(rename).toBeGreaterThan(0);
      expect(events[rename - 1]).toBe("sync-file");
    }
    const firstDirectorySync = events.indexOf("sync-dir");
    expect(firstDirectorySync).toBeGreaterThan(events.lastIndexOf("rename:site.css") - 1);
    expect(events.slice(firstDirectorySync).every((event) => event === "sync-dir")).toBe(true);
    expect(await readFile(path.join(destination, "css/site.css"), "utf8")).toBe("p{}");
  });

  test("Given a baseline copy, When it is materialized, Then every file is synced and the directories are flushed", async () => {
    const source = await tree({ "index.html": "<p>a</p>", "css/site.css": "p{}" });
    const destination = path.join(await tree({}), "baseline");
    const events: string[] = [];
    await materializeManagedTree(source, destination, recordingIo(events));
    expect(events.filter((event) => event === "sync-file")).toHaveLength(2);
    expect(events.filter((event) => event === "sync-dir").length).toBeGreaterThanOrEqual(2);
    expect(events.lastIndexOf("sync-file")).toBeLessThan(events.indexOf("sync-dir"));
    expect(await readFile(path.join(destination, "index.html"), "utf8")).toBe("<p>a</p>");
  });
});
