import type { Database } from "bun:sqlite";
import type { VisualAlternativeSummary } from "@bg/shared";
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

/** Every item turn starts from the restored base tree, so its operation base digest is the generation base digest. */
export type VisualAlternativeStageIdentity = {
  readonly projectId: string;
  readonly operationId: string;
  readonly baseDigest: string;
  readonly result?: { readonly revision: number; readonly digest: string };
};

export function visualAlternativeStageIdentity(
  alternative: VisualAlternativeSummary,
): VisualAlternativeStageIdentity {
  if (
    alternative.status !== "ready" ||
    alternative.result_revision === null ||
    alternative.result_digest === null
  ) {
    throw new VisualAlternativeStorageError("alternative_not_ready");
  }
  return {
    projectId: alternative.project_id,
    operationId: alternative.operation_id,
    baseDigest: alternative.source_digest,
    result: {
      revision: alternative.result_revision,
      digest: alternative.result_digest,
    },
  };
}

export async function visualAlternativeStage(
  db: Database,
  projectDir: string,
  identity: VisualAlternativeStageIdentity,
): Promise<VisualAlternativeStage> {
  const operationId = identity.operationId;
  const row = db.query<PersistedArtifactOperationRow, [string]>(
    "SELECT id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at FROM artifact_operations WHERE id=?",
  ).get(operationId);
  if (row === null) {
    throw new VisualAlternativeStorageError("alternative_not_ready");
  }
  let operation: ReturnType<typeof parsePersistedArtifactOperation>;
  try {
    operation = parsePersistedArtifactOperation(row);
  } catch {
    throw new VisualAlternativeStorageError("corrupt_visual_alternative");
  }
  if (
    operation.project_id !== identity.projectId ||
    operation.base_digest !== identity.baseDigest ||
    (identity.result !== undefined &&
      (operation.result_revision !== identity.result.revision ||
        operation.result_digest !== identity.result.digest))
  ) {
    throw new VisualAlternativeStorageError("corrupt_visual_alternative");
  }
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
  identity: VisualAlternativeStageIdentity,
  relativePath: string,
): Promise<{
  readonly bytes: Buffer<ArrayBuffer>;
  readonly sha256: string;
}> {
  const stage = await visualAlternativeStage(db, projectDir, identity);
  const file = manifestEntry(stage.manifest, relativePath);
  if (file === null) {
    throw new VisualAlternativeStorageError("alternative_file_not_found");
  }
  return {
    bytes: await readManagedFile(stage.path, file),
    sha256: file.sha256,
  };
}
