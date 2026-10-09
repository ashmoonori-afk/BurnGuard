import type { Database } from "bun:sqlite";
import { RETENTION_MS } from "../services/artifact-retention";
import type {
  VisualAlternativeList,
  VisualAlternativeListStatus,
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

const RETAINED_UNTIL = 253402300799999;
const RELEASED_RETENTION_MS = RETENTION_MS;

export function createVisualAlternativeGeneration(
  db: Database,
  input: {
    readonly generationId: string;
    readonly projectId: string;
    readonly baseRevision: number;
    readonly baseDigest: string;
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
        "INSERT INTO visual_alternative_generations(id,project_id,status,base_revision,base_digest,base_manifest_json,base_path,created_at,updated_at) VALUES (?,?,'generating',?,?,NULL,?,?,?)",
      ).run(
        input.generationId,
        input.projectId,
        input.baseRevision,
        input.baseDigest,
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

export function recordVisualAlternativeBase(
  db: Database,
  generationId: string,
  manifestJson: string,
  now: number,
): void {
  const result = db.prepare(
    "UPDATE visual_alternative_generations SET base_manifest_json=?,updated_at=? WHERE id=? AND status='generating' AND base_manifest_json IS NULL",
  ).run(manifestJson, now, generationId);
  if (result.changes !== 1) {
    throw new VisualAlternativeRepositoryError("invalid_transition");
  }
}

export function startVisualAlternative(
  db: Database,
  id: string,
  now: number,
): void {
  const result = db.prepare(
    "UPDATE visual_alternatives SET status='generating',updated_at=? WHERE id=? AND status='pending'",
  ).run(now, id);
  if (result.changes !== 1) {
    throw new VisualAlternativeRepositoryError("invalid_transition");
  }
}

export function markVisualAlternativeReady(
  db: Database,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly operationId: string;
    readonly resultRevision: number;
    readonly resultDigest: string;
    readonly now: number;
  },
): void {
  db.transaction(() => {
    const updated = db.prepare(
      "UPDATE visual_alternatives SET status='ready',result_revision=?,result_digest=?,updated_at=? WHERE id=? AND project_id=? AND operation_id=? AND status IN ('pending','generating')",
    ).run(
      input.resultRevision,
      input.resultDigest,
      input.now,
      input.id,
      input.projectId,
      input.operationId,
    );
    if (updated.changes !== 1) {
      throw new VisualAlternativeRepositoryError("invalid_transition");
    }
    const retained = db.prepare(
      "UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?),updated_at=? WHERE id=? AND project_id=? AND status='committed' AND result_revision=? AND result_digest=?",
    ).run(
      RETAINED_UNTIL,
      input.now,
      input.operationId,
      input.projectId,
      input.resultRevision,
      input.resultDigest,
    );
    if (retained.changes !== 1) {
      throw new VisualAlternativeRepositoryError("corrupt_visual_alternative");
    }
  })();
}

export function failVisualAlternative(
  db: Database,
  id: string,
  now: number,
): void {
  const result = db.prepare(
    "UPDATE visual_alternatives SET status='failed',result_revision=NULL,result_digest=NULL,updated_at=? WHERE id=? AND status IN ('pending','generating')",
  ).run(now, id);
  if (result.changes !== 1) {
    throw new VisualAlternativeRepositoryError("invalid_transition");
  }
}

export function finishVisualAlternativeGeneration(
  db: Database,
  generationId: string,
  now: number,
): VisualAlternativeListStatus {
  return db.transaction(() => {
    db.prepare(
      "UPDATE visual_alternatives SET status='failed',result_revision=NULL,result_digest=NULL,updated_at=? WHERE generation_id=? AND status IN ('pending','generating')",
    ).run(now, generationId);
    const counts = db.query<{ readonly total: number; readonly ready: number }, [string]>(
      "SELECT count(*) AS total, coalesce(sum(status='ready'),0) AS ready FROM visual_alternatives WHERE generation_id=?",
    ).get(generationId);
    const total = counts?.total ?? 0;
    const ready = counts?.ready ?? 0;
    const status: VisualAlternativeListStatus = total > 0 && ready === total
      ? "ready"
      : ready === 0
        ? "failed"
        : "partial";
    const result = db.prepare(
      "UPDATE visual_alternative_generations SET status=?,updated_at=? WHERE id=? AND status='generating'",
    ).run(status, now, generationId);
    if (result.changes !== 1) {
      throw new VisualAlternativeRepositoryError("invalid_transition");
    }
    return status;
  })();
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
  now: number,
): void {
  db.transaction(() => {
    const alternative = getVisualAlternative(db, projectId, alternativeId);
    if (alternative === null) {
      throw new VisualAlternativeRepositoryError("alternative_not_found");
    }
    if (alternative.status === "pending" || alternative.status === "generating") {
      throw new VisualAlternativeRepositoryError("generation_active");
    }
    // Recovery of an unfinished generation relies on every operation it produced.
    const parentActive = db.query<{ readonly found: number }, [string, string]>(
      "SELECT 1 AS found FROM visual_alternative_generations WHERE id=? AND project_id=? AND status='generating'",
    ).get(alternative.generation_id, projectId);
    if (parentActive !== null) {
      throw new VisualAlternativeRepositoryError("generation_active");
    }
    const deleted = db.prepare(
      "DELETE FROM visual_alternatives WHERE project_id=? AND id=? AND status=? AND operation_id=?",
    ).run(projectId, alternativeId, alternative.status, alternative.operation_id);
    if (deleted.changes !== 1) {
      throw new VisualAlternativeRepositoryError("invalid_transition");
    }
    const released = db.prepare(
      "UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?),updated_at=? WHERE id=? AND project_id=? AND status='committed' AND json_extract(retention_json,'$.retained_until')=?",
    ).run(now + RELEASED_RETENTION_MS, now, alternative.operation_id, projectId, RETAINED_UNTIL);
    if (alternative.status === "ready" && released.changes !== 1) {
      throw new VisualAlternativeRepositoryError("corrupt_visual_alternative");
    }
  })();
}

/** Startup repair: ready rows pin their operation; nothing else keeps the alternative pin. */
export function repairVisualAlternativeRetention(
  db: Database,
  now: number,
): { readonly retained: number; readonly released: number } {
  return db.transaction(() => {
    const retained = db.prepare(
      `UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?),updated_at=?
        WHERE status='committed'
          AND json_extract(retention_json,'$.retained_until') IS NOT ?
          AND EXISTS (SELECT 1 FROM visual_alternatives a
            WHERE a.operation_id=artifact_operations.id AND a.project_id=artifact_operations.project_id
              AND a.status='ready' AND a.result_revision=artifact_operations.result_revision
              AND a.result_digest=artifact_operations.result_digest)`,
    ).run(RETAINED_UNTIL, now, RETAINED_UNTIL).changes;
    const released = db.prepare(
      `UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?),updated_at=?
        WHERE json_extract(retention_json,'$.retained_until')=?
          AND NOT EXISTS (SELECT 1 FROM visual_alternatives a
            WHERE a.operation_id=artifact_operations.id AND a.project_id=artifact_operations.project_id
              AND a.status='ready' AND a.result_revision=artifact_operations.result_revision
              AND a.result_digest=artifact_operations.result_digest)`,
    ).run(now + RELEASED_RETENTION_MS, now, RETAINED_UNTIL).changes;
    return { retained, released };
  })();
}

const SELECT_ALTERNATIVE = `SELECT
  a.id,a.project_id,a.generation_id,a.name,a.ordinal,a.status,
  a.source_revision,a.source_digest,a.result_revision,a.result_digest,
  a.operation_id,p.entrypoint,a.created_at,a.updated_at
  FROM visual_alternatives a JOIN projects p ON p.id=a.project_id`;
