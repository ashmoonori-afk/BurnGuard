import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reconcileArtifactState } from "../src/services/artifact-recovery";
import { PhotoRecordPublication, prepareStagedPhotoRecord } from "../src/services/photo-placement-publication";
import { readPhotoPlacements } from "../src/services/photo-placements";

const REFERENCE = ".meta/references/lamp.png";
const WORKER = path.join(import.meta.dir, "fixtures", "photo-crash-worker.ts");
const CRASH_EXIT = 77;
const temps: string[] = [];
let temp: string;
let root: string;

beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "bg-photo-crash-"));
  temps.push(temp);
  root = path.join(temp, "project");
});

afterEach(async () => {
  await Promise.all(temps.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Runs the worker to its fault point; the process ends there, leaving a half-finished operation on disk. */
function crashAt(point: "afterPublishWrite" | "beforeDatabaseCommit"): void {
  const child = Bun.spawnSync(["bun", WORKER, temp, point], { env: { ...process.env, BG_APP_ROOT: path.join(temp, "profile") }, timeout: 60_000 });
  if (child.exitCode !== CRASH_EXIT) throw new Error(`worker exited ${child.exitCode}: ${child.stderr.toString()}`);
}

async function purpose(): Promise<string | null> {
  const read = await readPhotoPlacements(root);
  return read.kind === "present" ? (read.record.placements[0]?.purpose ?? null) : null;
}

describe("photo record durable recovery", () => {
  test("Given a crash after the canonical files were published and before the photo record was installed, When startup recovery commits the operation, Then the new record and reference are installed with it", async () => {
    crashAt("afterPublishWrite");
    expect(await purpose()).toBe("Old placement");
    const db = new Database(path.join(temp, "state.sqlite"));
    try {
      const recovery = await reconcileArtifactState(db);

      expect(recovery).toMatchObject({ operations: 1, unavailableProjects: [] });
      expect(db.query("SELECT current_revision FROM projects WHERE id='p'").get()).toEqual({ current_revision: 2 });
      expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<p>Second</p>");
      expect(await purpose()).toBe("New placement");
      expect((await readFile(path.join(root, REFERENCE))).toString()).toBe("new reference bytes");
    } finally { db.close(); }
  }, 120_000);

  test("Given a recovered commit, When startup recovery runs again, Then the new record is unchanged", async () => {
    crashAt("afterPublishWrite");
    const db = new Database(path.join(temp, "state.sqlite"));
    try {
      await reconcileArtifactState(db);
      await reconcileArtifactState(db);

      expect(await purpose()).toBe("New placement");
      expect((await readFile(path.join(root, REFERENCE))).toString()).toBe("new reference bytes");
    } finally { db.close(); }
  }, 120_000);

  test("Given a crash after the photo record was installed and before the commit, When the live files changed so the operation is rolled back, Then the previous record and reference are restored", async () => {
    crashAt("beforeDatabaseCommit");
    expect(await purpose()).toBe("New placement");
    await writeFile(path.join(root, "index.html"), "<p>Edited elsewhere</p>");
    const db = new Database(path.join(temp, "state.sqlite"));
    try {
      await reconcileArtifactState(db);

      expect(db.query("SELECT current_revision FROM projects WHERE id='p'").get()).toEqual({ current_revision: 1 });
      expect(await purpose()).toBe("Old placement");
      expect((await readFile(path.join(root, REFERENCE))).toString()).toBe("old reference bytes");
    } finally { db.close(); }
  }, 120_000);

  test("Given an installation repeated after a crash, When it is installed twice and rolled back twice, Then the original record and reference are back", async () => {
    const stage = path.join(temp, "stage");
    const oldReference = Buffer.from("old reference bytes");
    const newReference = Buffer.from("new reference bytes");
    const write = async (dir: string, purposeText: string, reference: Buffer): Promise<void> => {
      await mkdir(path.join(dir, ".meta", "references"), { recursive: true });
      await writeFile(path.join(dir, REFERENCE), reference);
      await writeFile(path.join(dir, ".meta", "photo-placements.json"), JSON.stringify({ schema_version: 1, placements: [{
        id: "hero", purpose: purposeText, box: { width_px: 100, height_px: 100 }, placement_mode: "cover", text_safe_region: null,
        references: [{ url: "https://example.test/lamp", licence: "CC0", local_file: REFERENCE, sha256: createHash("sha256").update(reference).digest("hex") }],
        scale_facts: [], attachment_receipt: "yes", candidates: [{ id: "c1", file: "a.png", rejected_reason: "x" }, { id: "c2", file: "b.png", rejected_reason: null }], chosen_candidate: "c2",
      }] }));
    };
    await write(root, "Old placement", oldReference);
    await write(stage, "New placement", newReference);
    const prepared = await prepareStagedPhotoRecord(stage);
    if (prepared.kind !== "ready") throw new Error("fixture record must be valid");
    const publication = new PhotoRecordPublication(prepared, root, path.join(temp, "photo-backup"));

    await publication.install();
    await publication.install();
    expect(await purpose()).toBe("New placement");
    await publication.rollback();
    await publication.rollback();

    expect(await purpose()).toBe("Old placement");
    expect(await readFile(path.join(root, REFERENCE))).toEqual(oldReference);
  });
});
