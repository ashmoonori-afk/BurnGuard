import type { Database } from "bun:sqlite";
import { adoptExistingArtifact } from "./artifact-initialization";
import { digestEntries, validateCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { parsePersistedArtifactOperation, type PersistedArtifactOperationRow } from "./artifact-operation-record";
import { isProjectDocumentPath } from "./project-document-paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";

/** Older development builds counted uploaded originals as an external artifact revision. */
export async function migrateDocumentOnlyRevision(db: Database, project: { id: string; dir_path: string; current_digest: string | null }, actual: CanonicalTreeManifest): Promise<boolean> {
  const row = db.query<PersistedArtifactOperationRow, [string, string | null]>("SELECT * FROM artifact_operations WHERE project_id=? AND status='committed' AND result_digest=? ORDER BY result_revision DESC,created_at DESC LIMIT 1").get(project.id, project.current_digest);
  if (row === null) return false;
  const operation = parsePersistedArtifactOperation(row);
  const base = operation.snapshot.base_manifest;
  if (operation.replay.kind !== "external" || base.tree_digest !== actual.tree_digest || base.tree_digest !== operation.base_digest || !operation.diff.length ||
      operation.diff.some(file => file.action !== "created" || !isProjectDocumentPath(file.path) || file.after_hash === null)) return false;
  const legacyFiles = [...base.files, ...operation.diff.map(file => ({ path: file.path, size: file.after_bytes, sha256: file.after_hash! }))].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (digestEntries(legacyFiles) !== project.current_digest) return false;
  // Do not trust stored paths or adopt arbitrary live changes as a repaired identity.
  const owned = resolveWithin(project.dir_path, ".meta", "artifact-operations", assertSafeName(operation.id));
  const snapshot = resolveWithin(owned, "snapshot"), stage = resolveWithin(owned, "stage");
  if (operation.snapshot.snapshot_path !== snapshot || operation.snapshot.stage_path !== stage) return false;
  await validateCanonicalTree(snapshot, base);
  await validateCanonicalTree(stage, base);
  const current = db.query<{ current_revision: number; current_digest: string | null }, [string]>("SELECT current_revision,current_digest FROM projects WHERE id=?").get(project.id);
  if (current?.current_revision !== operation.result_revision || current.current_digest !== project.current_digest ||
      db.query("SELECT id FROM artifact_operations WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1").get(project.id)) return false;
  await adoptExistingArtifact(db, project.id, project.dir_path, current.current_revision, actual, current.current_digest);
  return true;
}
