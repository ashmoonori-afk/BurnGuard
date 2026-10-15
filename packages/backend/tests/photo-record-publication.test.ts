import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PHOTO_PLACEMENTS_FILE, type PhotoPlacementV1 } from "@bg/shared";
import { ArtifactCoordinator, ArtifactOperationError } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { readPhotoPlacements } from "../src/services/photo-placements";
import { runMigrationsFrom } from "../src/db/migrate";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

const roots: string[] = [];
let db: Database;
let root: string;

const REFERENCE = ".meta/references/lamp.png";

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function record(bytes: Buffer, purpose = "Hero photograph of a desk lamp", overrides: Partial<PhotoPlacementV1> = {}): string {
  const placement: PhotoPlacementV1 = {
    id: "hero",
    purpose,
    box: { width_px: 1200, height_px: 600 },
    placement_mode: "cover",
    text_safe_region: null,
    references: [{ url: "https://example.test/lamp", licence: "CC0", local_file: REFERENCE, sha256: sha(bytes) }],
    scale_facts: [],
    attachment_receipt: "yes",
    candidates: [{ id: "c1", file: "images/c1.png", rejected_reason: "Too wide" }, { id: "c2", file: "images/c2.png", rejected_reason: null }],
    chosen_candidate: "c2",
    ...overrides,
  };
  return JSON.stringify({ schema_version: 1, placements: [placement] });
}

async function stageRecord(stage: string, json: string, reference: Buffer | null): Promise<void> {
  await mkdir(path.join(stage, ".meta", "references"), { recursive: true });
  await writeFile(path.join(stage, PHOTO_PLACEMENTS_FILE), json);
  if (reference !== null) await writeFile(path.join(stage, REFERENCE), reference);
}

async function turn(coordinator: ArtifactCoordinator, revision: number, digest: string, html: string, mutate: (stage: string) => Promise<void>): Promise<{ resultRevision: number; resultDigest: string }> {
  return coordinator.run({
    projectId: "p", projectDir: root, kind: "turn", expectedRevision: revision, expectedArtifactDigest: digest,
    mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), html); await mutate(stage); },
  });
}

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(tmpdir(), "burnguard-photo-record-"));
  roots.push(root);
  await writeFile(path.join(root, "index.html"), "<p>base</p>");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
});

afterEach(async () => {
  db.close();
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("photo placement record publication", () => {
  test("Given a turn that writes a valid record and its reference in the stage, When it commits, Then the published project has the record and the reference", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const reference = Buffer.from("synthetic reference bytes");
    await turn(coordinator, 0, base.tree_digest, "<p>one</p>", (stage) => stageRecord(stage, record(reference), reference));

    const read = await readPhotoPlacements(root);
    expect(read.kind).toBe("present");
    expect(await readFile(path.join(root, REFERENCE))).toEqual(reference);
  });

  test("Given a published record, When the deliverable tree is inspected, Then no .meta file is part of it", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const reference = Buffer.from("synthetic reference bytes");
    await turn(coordinator, 0, base.tree_digest, "<p>one</p>", async (stage) => { await stageRecord(stage, record(reference), reference); await writeFile(path.join(stage, ".meta", "other.json"), "{}"); });

    expect((await inspectCanonicalTree(root)).files.some((file) => file.path.startsWith(".meta"))).toBe(false);
    expect(await readFile(path.join(root, ".meta", "other.json"), "utf8").catch(() => null)).toBeNull();
  });

  test("Given a previous record, When the next turn fails at the database commit, Then the previous record and reference are restored", async () => {
    const first = new ArtifactCoordinator(db);
    const base = await first.initialize("p", root);
    const oldReference = Buffer.from("old reference bytes");
    const one = await turn(first, 0, base.tree_digest, "<p>one</p>", (stage) => stageRecord(stage, record(oldReference, "Old purpose"), oldReference));
    const newReference = Buffer.from("new reference bytes");
    const failing = new ArtifactCoordinator(db, { beforeDatabaseCommit: () => { throw new ArtifactOperationError("database_commit_failed", "fault"); } });

    await expect(turn(failing, one.resultRevision, one.resultDigest, "<p>two</p>", (stage) => stageRecord(stage, record(newReference, "New purpose"), newReference))).rejects.toMatchObject({ code: "database_commit_failed" });

    const read = await readPhotoPlacements(root);
    expect(read.kind === "present" ? read.record.placements[0]?.purpose : null).toBe("Old purpose");
    expect(await readFile(path.join(root, REFERENCE))).toEqual(oldReference);
  });

  test("Given no previous record, When a turn fails at the database commit, Then no record is left behind", async () => {
    const coordinator = new ArtifactCoordinator(db, { beforeDatabaseCommit: () => { throw new ArtifactOperationError("database_commit_failed", "fault"); } });
    const base = await coordinator.initialize("p", root);
    const reference = Buffer.from("synthetic reference bytes");

    await expect(turn(coordinator, 0, base.tree_digest, "<p>one</p>", (stage) => stageRecord(stage, record(reference), reference))).rejects.toMatchObject({ code: "database_commit_failed" });

    expect((await readPhotoPlacements(root)).kind).toBe("absent");
    expect(await readFile(path.join(root, REFERENCE)).catch(() => null)).toBeNull();
  });

  const invalidCases: readonly [string, (reference: Buffer) => { json: string; file: Buffer | null }][] = [
    ["a stretch placement mode", (reference) => ({ json: record(reference).replace('"cover"', '"stretch"'), file: reference })],
    ["a reference whose bytes do not match the declared hash", (reference) => ({ json: record(reference), file: Buffer.from("different bytes") })],
    ["a reference file that is missing", (reference) => ({ json: record(reference), file: null })],
  ];
  for (const [name, build] of invalidCases) {
    test(`Given a previous record, When a turn stages ${name}, Then the artifact publishes and the previous record stays`, async () => {
      const coordinator = new ArtifactCoordinator(db);
      const base = await coordinator.initialize("p", root);
      const oldReference = Buffer.from("old reference bytes");
      const one = await turn(coordinator, 0, base.tree_digest, "<p>one</p>", (stage) => stageRecord(stage, record(oldReference, "Old purpose"), oldReference));
      const reference = Buffer.from("new reference bytes");
      const { json, file } = build(reference);

      const two = await turn(coordinator, one.resultRevision, one.resultDigest, "<p>two</p>", (stage) => stageRecord(stage, json, file));

      expect(two.resultRevision).toBe(2);
      expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<p>two</p>");
      const read = await readPhotoPlacements(root);
      expect(read.kind === "present" ? read.record.placements[0]?.purpose : null).toBe("Old purpose");
      expect(await readFile(path.join(root, REFERENCE))).toEqual(oldReference);
    });
  }

  test.skipIf(!canCreateSymlink())(`Given a reference that is a symlink to a file outside the stage, When a turn commits, Then the record is not published ${SYMLINK_SKIP_REASON}`, async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const outside = path.join(root, "..", `outside-${path.basename(root)}.png`);
    const reference = Buffer.from("outside bytes");
    await writeFile(outside, reference);
    roots.push(outside);

    await turn(coordinator, 0, base.tree_digest, "<p>one</p>", async (stage) => {
      await stageRecord(stage, record(reference), null);
      await symlink(outside, path.join(stage, REFERENCE));
    });

    expect((await readPhotoPlacements(root)).kind).toBe("absent");
  });

  test("Given a published record, When the next turn does not touch metadata, Then the stage starts with the record and it stays published", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const reference = Buffer.from("synthetic reference bytes");
    const one = await turn(coordinator, 0, base.tree_digest, "<p>one</p>", (stage) => stageRecord(stage, record(reference), reference));
    let seeded = false;

    await turn(coordinator, one.resultRevision, one.resultDigest, "<p>two</p>", async (stage) => {
      seeded = (await readFile(path.join(stage, REFERENCE)).catch(() => null))?.equals(reference) === true && (await readFile(path.join(stage, PHOTO_PLACEMENTS_FILE)).catch(() => null)) !== null;
    });

    expect(seeded).toBe(true);
    expect((await readPhotoPlacements(root)).kind).toBe("present");
    expect(await readFile(path.join(root, REFERENCE))).toEqual(reference);
  });
});
