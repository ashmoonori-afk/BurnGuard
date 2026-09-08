import type { Database } from "bun:sqlite";
import path from "node:path";
import { ulid } from "ulid";
import { rm } from "node:fs/promises";
import { replaceArtifactFileIndexInTransaction } from "../db/artifact-file-index";
import { validateCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { materializeManagedTree } from "./artifact-tree-storage";

export async function adoptExistingArtifact(db: Database, projectId: string, projectDir: string, revision: number, actual: CanonicalTreeManifest): Promise<string> {
  const id = ulid(); const now = Date.now(); const ownedRoot = path.join(projectDir, ".meta", "artifact-operations", id);
  const snapshotPath = path.join(ownedRoot, "snapshot"); const stagePath = path.join(ownedRoot, "stage");
  let committed = false;
  try {
  await materializeManagedTree(projectDir, snapshotPath); await validateCanonicalTree(snapshotPath, actual);
  await materializeManagedTree(projectDir, stagePath); await validateCanonicalTree(stagePath, actual);
  await validateCanonicalTree(projectDir, actual);
  const snapshot = { schema_version: 1, snapshot_path: snapshotPath, stage_path: stagePath, base_manifest: actual };
  const retention = { schema_version: 1, replayable: true, retained_until: now + 30 * 24 * 60 * 60 * 1000, pruned_at: null, prune_reason: null };
  const replay = { schema_version: 1, kind: "initialize", parent_operation_id: null, publication: "base" };
  db.transaction(() => {
    const changed = db.prepare("UPDATE projects SET current_digest=? WHERE id=? AND current_revision=? AND current_digest IS NULL").run(actual.tree_digest, projectId, revision);
    if (changed.changes !== 1) throw new Error("Project adoption authority changed");
    db.prepare("INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES (?,?, 'cancelled',?,?,?,?,?,'','','[]',?,?,?,?,?)").run(id, projectId, revision, actual.tree_digest, revision, actual.tree_digest, revision, JSON.stringify(snapshot), JSON.stringify(retention), JSON.stringify(replay), now, now);
    replaceArtifactFileIndexInTransaction(db, projectId, actual);
  })();
  committed = true;
  return stagePath;
  } finally { if (!committed) await rm(ownedRoot, { recursive: true, force: true }); }
}

export function establishEmptyArtifactAuthority(db: Database, projectId: string, empty: CanonicalTreeManifest): void {
  db.transaction(() => {
    const changed = db.prepare("UPDATE projects SET current_digest=? WHERE id=? AND current_revision=0 AND current_digest IS NULL").run(empty.tree_digest, projectId);
    if (changed.changes !== 1) throw new Error("Project initialization authority changed");
    replaceArtifactFileIndexInTransaction(db, projectId, empty);
  })();
}
