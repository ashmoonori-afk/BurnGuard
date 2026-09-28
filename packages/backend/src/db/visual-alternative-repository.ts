import type { Database } from "bun:sqlite";
import type {
  VisualAlternativeList,
  VisualAlternativeListStatus,
  VisualAlternativeStatus,
  VisualAlternativeSummary,
} from "@bg/shared";
import {
  parseVisualAlternative,
  parseVisualAlternativeGeneration,
  type PersistedAlternativeRow,
  type VisualAlternativeGenerationRow,
} from "./visual-alternative-record";

export class VisualAlternativeRepositoryError extends Error {
  readonly name = "VisualAlternativeRepositoryError";
  constructor(
    readonly code:
      | "alternative_not_found"
      | "alternative_not_ready"
      | "generation_active"
      | "invalid_transition"
      | "corrupt_visual_alternative",
  ) {
    super(code);
  }
}

export function createVisualAlternativeGeneration(
  db: Database,
  input: {
    readonly generationId: string;
    readonly projectId: string;
    readonly baseRevision: number;
    readonly baseDigest: string;
    readonly baseManifestJson: string;
    readonly basePath: string;
    readonly alternatives: readonly {
      readonly id: string;
      readonly name: string;
      readonly operationId: string;
    }[];
    readonly now: number;
  },
): void {
  try {
    db.transaction(() => {
      db.prepare(
        "INSERT INTO visual_alternative_generations(id,project_id,status,base_revision,base_digest,base_manifest_json,base_path,created_at,updated_at) VALUES (?,?,'generating',?,?,?,?,?,?)",
      ).run(
        input.generationId,
        input.projectId,
        input.baseRevision,
        input.baseDigest,
        input.baseManifestJson,
        input.basePath,
        input.now,
        input.now,
      );
      const insert = db.prepare(
        "INSERT INTO visual_alternatives(id,project_id,generation_id,name,ordinal,status,source_revision,source_digest,result_revision,result_digest,operation_id,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?,NULL,NULL,?,?,?)",
      );
      input.alternatives.forEach((alternative, ordinal) => {
        insert.run(
          alternative.id,
          input.projectId,
          input.generationId,
          alternative.name,
          ordinal,
          input.baseRevision,
          input.baseDigest,
          alternative.operationId,
          input.now,
          input.now,
        );
      });
    })();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("uq_visual_alternative_generation_active")
    ) {
      throw new VisualAlternativeRepositoryError("generation_active");
    }
    throw error;
  }
}

export function transitionVisualAlternative(
  db: Database,
  input: {
    readonly id: string;
    readonly from: VisualAlternativeStatus;
    readonly to: VisualAlternativeStatus;
    readonly resultRevision?: number;
    readonly resultDigest?: string;
    readonly now: number;
  },
): void {
  const result = db.prepare(
    "UPDATE visual_alternatives SET status=?,result_revision=?,result_digest=?,updated_at=? WHERE id=? AND status=?",
  ).run(
    input.to,
    input.resultRevision ?? null,
    input.resultDigest ?? null,
    input.now,
    input.id,
    input.from,
  );
  if (result.changes !== 1) {
    throw new VisualAlternativeRepositoryError("invalid_transition");
  }
}

export function finishVisualAlternativeGeneration(
  db: Database,
  generationId: string,
  status: VisualAlternativeListStatus,
  now: number,
): void {
  const result = db.prepare(
    "UPDATE visual_alternative_generations SET status=?,updated_at=? WHERE id=? AND status='generating'",
  ).run(status, now, generationId);
  if (result.changes !== 1) {
    throw new VisualAlternativeRepositoryError("invalid_transition");
  }
}

export function latestVisualAlternatives(
  db: Database,
  projectId: string,
): VisualAlternativeList | null {
  const generation = db.query<VisualAlternativeGenerationRow, [string]>(
    "SELECT id,project_id,status,created_at,updated_at FROM visual_alternative_generations WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
  ).get(projectId);
  if (generation === null) return null;
  const parsedGeneration = parseVisualAlternativeGeneration(generation);
  const rows = db.query<PersistedAlternativeRow, [string]>(
    `${SELECT_ALTERNATIVE} WHERE a.project_id=? ORDER BY a.created_at DESC,a.generation_id DESC,a.ordinal`,
  ).all(projectId);
  return {
    schema_version: 1,
    project_id: parsedGeneration.projectId,
    generation_id: parsedGeneration.id,
    status: parsedGeneration.status,
    alternatives: rows.map(parseVisualAlternative),
    created_at: parsedGeneration.createdAt,
    updated_at: parsedGeneration.updatedAt,
  };
}

export function getVisualAlternative(
  db: Database,
  projectId: string,
  alternativeId: string,
): VisualAlternativeSummary | null {
  const row = db.query<PersistedAlternativeRow, [string, string]>(
    `${SELECT_ALTERNATIVE} WHERE a.project_id=? AND a.id=?`,
  ).get(projectId, alternativeId);
  return row === null ? null : parseVisualAlternative(row);
}

export function deleteVisualAlternative(
  db: Database,
  projectId: string,
  alternativeId: string,
): string {
  const alternative = getVisualAlternative(db, projectId, alternativeId);
  if (alternative === null) {
    throw new VisualAlternativeRepositoryError("alternative_not_found");
  }
  if (alternative.status === "pending" || alternative.status === "generating") {
    throw new VisualAlternativeRepositoryError("generation_active");
  }
  db.prepare("DELETE FROM visual_alternatives WHERE project_id=? AND id=?").run(
    projectId,
    alternativeId,
  );
  return alternative.operation_id;
}

export function retainVisualAlternativeOperation(
  db: Database,
  operationId: string,
): void {
  db.prepare(
    "UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',253402300799999),updated_at=? WHERE id=? AND status='committed'",
  ).run(Date.now(), operationId);
}

export function releaseVisualAlternativeOperation(
  db: Database,
  operationId: string,
): void {
  db.prepare(
    "UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?),updated_at=? WHERE id=? AND status='committed'",
  ).run(Date.now() + 30 * 24 * 60 * 60 * 1000, Date.now(), operationId);
}

const SELECT_ALTERNATIVE = `SELECT
  a.id,a.project_id,a.generation_id,a.name,a.ordinal,a.status,
  a.source_revision,a.source_digest,a.result_revision,a.result_digest,
  a.operation_id,p.entrypoint,a.created_at,a.updated_at
  FROM visual_alternatives a JOIN projects p ON p.id=a.project_id`;
