import type { Database } from "bun:sqlite";
import path from "node:path";
import {
  parsePersistedArtifactOperation,
  type PersistedArtifactOperationRow,
} from "./artifact-operation-record";
import {
  inspectCanonicalTree,
  type CanonicalTreeManifest,
} from "./canonical-tree-manifest";
import { manifestEntry, readManagedFile } from "./artifact-tree-storage";
import { resolveWithin } from "../security/path-boundary";

export class VisualAlternativeStorageError extends Error {
  readonly name = "VisualAlternativeStorageError";
  constructor(
    readonly code:
      | "alternative_not_ready"
      | "alternative_file_not_found"
      | "corrupt_visual_alternative",
  ) {
    super(code);
  }
}

export type VisualAlternativeStage = {
  readonly path: string;
  readonly revision: number;
  readonly digest: string;
  readonly manifest: CanonicalTreeManifest;
};

export async function visualAlternativeStage(
  db: Database,
  projectDir: string,
  operationId: string,
): Promise<VisualAlternativeStage> {
  const row = db.query<PersistedArtifactOperationRow, [string]>(
    "SELECT id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at FROM artifact_operations WHERE id=?",
  ).get(operationId);
  if (row === null) {
    throw new VisualAlternativeStorageError("alternative_not_ready");
  }
  const operation = parsePersistedArtifactOperation(row);
  if (
    operation.status !== "committed" ||
    operation.result_revision === null ||
    operation.result_digest === null ||
    !operation.retention.replayable
  ) {
    throw new VisualAlternativeStorageError("alternative_not_ready");
  }
  const expected = resolveWithin(
    projectDir,
    ".meta",
    "artifact-operations",
    operation.id,
    "stage",
  );
  const stagePath = path.resolve(operation.snapshot.stage_path);
  if (stagePath !== expected) {
    throw new VisualAlternativeStorageError("corrupt_visual_alternative");
  }
  let manifest: CanonicalTreeManifest;
  try {
    manifest = await inspectCanonicalTree(stagePath);
  } catch {
    throw new VisualAlternativeStorageError("corrupt_visual_alternative");
  }
  if (manifest.tree_digest !== operation.result_digest) {
    throw new VisualAlternativeStorageError("corrupt_visual_alternative");
  }
  return {
    path: stagePath,
    revision: operation.result_revision,
    digest: operation.result_digest,
    manifest,
  };
}

export async function readVisualAlternativeFile(
  db: Database,
  projectDir: string,
  operationId: string,
  relativePath: string,
): Promise<{
  readonly bytes: Buffer<ArrayBuffer>;
  readonly sha256: string;
}> {
  const stage = await visualAlternativeStage(db, projectDir, operationId);
  const file = manifestEntry(stage.manifest, relativePath);
  if (file === null) {
    throw new VisualAlternativeStorageError("alternative_file_not_found");
  }
  return {
    bytes: await readManagedFile(stage.path, file),
    sha256: file.sha256,
  };
}
