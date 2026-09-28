import type {
  VisualAlternativeListStatus,
  VisualAlternativeStatus,
  VisualAlternativeSummary,
} from "@bg/shared";

export type VisualAlternativeGenerationRow = {
  readonly id: unknown;
  readonly project_id: unknown;
  readonly status: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
};

export type PersistedAlternativeRow = {
  readonly id: unknown;
  readonly project_id: unknown;
  readonly generation_id: unknown;
  readonly name: unknown;
  readonly ordinal: unknown;
  readonly status: unknown;
  readonly source_revision: unknown;
  readonly source_digest: unknown;
  readonly result_revision: unknown;
  readonly result_digest: unknown;
  readonly operation_id: unknown;
  readonly entrypoint: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
};

export class VisualAlternativeRecordError extends Error {
  readonly name = "VisualAlternativeRecordError";
  readonly code = "corrupt_visual_alternative" as const;
}

export function parseVisualAlternativeGeneration(row: VisualAlternativeGenerationRow): {
  readonly id: string;
  readonly projectId: string;
  readonly status: VisualAlternativeListStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
} {
  const status = row.status;
  if (
    status !== "generating" &&
    status !== "ready" &&
    status !== "partial" &&
    status !== "failed"
  ) {
    corrupt();
  }
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    status,
    createdAt: count(row.created_at),
    updatedAt: count(row.updated_at),
  };
}

export function parseVisualAlternative(
  row: PersistedAlternativeRow,
): VisualAlternativeSummary {
  const status = parseStatus(row.status);
  const resultRevision = nullableCount(row.result_revision);
  const resultDigest = nullableDigest(row.result_digest);
  if (
    status === "ready"
      ? resultRevision === null || resultDigest === null
      : resultRevision !== null || resultDigest !== null
  ) {
    corrupt();
  }
  const projectId = text(row.project_id);
  const id = text(row.id);
  return {
    id,
    project_id: projectId,
    generation_id: text(row.generation_id),
    name: text(row.name),
    status,
    source_revision: count(row.source_revision),
    source_digest: digest(row.source_digest),
    result_revision: resultRevision,
    result_digest: resultDigest,
    operation_id: text(row.operation_id),
    entrypoint_url: status === "ready"
      ? `/api/projects/${encodeURIComponent(projectId)}/alternatives/${encodeURIComponent(id)}/fs/${encodePath(text(row.entrypoint))}`
      : null,
    created_at: count(row.created_at),
    updated_at: count(row.updated_at),
  };
}

function parseStatus(value: unknown): VisualAlternativeStatus {
  if (
    value !== "pending" &&
    value !== "generating" &&
    value !== "ready" &&
    value !== "failed"
  ) {
    corrupt();
  }
  return value;
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) corrupt();
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    corrupt();
  }
  return value;
}
function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}
function digest(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) corrupt();
  return result;
}
function nullableDigest(value: unknown): string | null {
  return value === null ? null : digest(value);
}
function corrupt(): never {
  throw new VisualAlternativeRecordError();
}
