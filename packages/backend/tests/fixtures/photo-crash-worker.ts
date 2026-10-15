import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { ArtifactCoordinator } from "../../src/services/artifact-coordinator";
import { runMigrationsFrom } from "../../src/db/migrate";

/**
 * Child process for photo-record-crash-recovery.test.ts. Commits revision 1 with an old placement record, then
 * stages revision 2 with a new one and terminates the process (exit 77) at the named fault point of the second run.
 * Usage: bun photo-crash-worker.ts <temp dir> <afterPublishWrite|beforeDatabaseCommit>
 */
const [temp, point] = [process.argv[2], process.argv[3]];
if (temp === undefined || (point !== "afterPublishWrite" && point !== "beforeDatabaseCommit")) throw new Error("usage: photo-crash-worker.ts <temp dir> <fault point>");

const REFERENCE = ".meta/references/lamp.png";
const db = new Database(path.join(temp, "state.sqlite"));
await runMigrationsFrom(db, path.join(import.meta.dir, "../../src/db/migrations"));
const root = path.join(temp, "project");
await mkdir(root, { recursive: true });
await writeFile(path.join(root, "index.html"), "<p>Base</p>");
db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);

function record(purpose: string, reference: Buffer): string {
  return JSON.stringify({
    schema_version: 1,
    placements: [{
      id: "hero", purpose, box: { width_px: 100, height_px: 100 }, placement_mode: "cover", text_safe_region: null,
      references: [{ url: "https://example.test/lamp", licence: "CC0", local_file: REFERENCE, sha256: createHash("sha256").update(reference).digest("hex") }],
      scale_facts: [], attachment_receipt: "yes",
      candidates: [{ id: "c1", file: "images/c1.png", rejected_reason: "Too wide" }, { id: "c2", file: "images/c2.png", rejected_reason: null }], chosen_candidate: "c2",
    }],
  });
}

function stage(html: string, purpose: string, reference: Buffer) {
  return async (dir: string): Promise<void> => {
    await writeFile(path.join(dir, "index.html"), html);
    await mkdir(path.join(dir, ".meta", "references"), { recursive: true });
    await writeFile(path.join(dir, ".meta", "photo-placements.json"), record(purpose, reference));
    await writeFile(path.join(dir, REFERENCE), reference);
  };
}

const coordinator = new ArtifactCoordinator(db);
const base = await coordinator.initialize("p", root);
const first = await coordinator.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: stage("<p>First</p>", "Old placement", Buffer.from("old reference bytes")) });
const crash = (): never => process.exit(77);
const crashing = new ArtifactCoordinator(db, point === "afterPublishWrite" ? { afterPublishWrite: crash } : { beforeDatabaseCommit: crash });
await crashing.run({ projectId: "p", projectDir: root, kind: "turn", expectedRevision: first.resultRevision, expectedArtifactDigest: first.resultDigest, mutate: stage("<p>Second</p>", "New placement", Buffer.from("new reference bytes")) });
throw new Error("fault point did not fire");
