import {
  UpgradeContractError,
  decodeContract,
  optionalString,
  requiredArray,
  requiredNumber,
  requiredString,
  type UnknownRecord,
} from "./contract-parser";

export type VisualAlternativeCount = 2 | 3 | 4;

export type CreateVisualAlternativesRequest = {
  readonly count: VisualAlternativeCount;
  readonly prompt: string;
  readonly names: readonly string[];
};

export type VisualAlternativeStatus =
  | "pending"
  | "generating"
  | "ready"
  | "failed";

export type VisualAlternativeSummary = {
  readonly id: string;
  readonly project_id: string;
  readonly generation_id: string;
  readonly name: string;
  readonly status: VisualAlternativeStatus;
  readonly source_revision: number;
  readonly source_digest: string;
  readonly result_revision: number | null;
  readonly result_digest: string | null;
  readonly operation_id: string;
  readonly entrypoint_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

export type VisualAlternativeListStatus =
  | "generating"
  | "ready"
  | "partial"
  | "failed";

export type VisualAlternativeList = {
  readonly schema_version: 1;
  readonly project_id: string;
  readonly generation_id: string;
  readonly status: VisualAlternativeListStatus;
  readonly alternatives: readonly VisualAlternativeSummary[];
  readonly created_at: number;
  readonly updated_at: number;
};

const REQUEST_KEYS = ["count", "prompt", "names"] as const;
const LIST_KEYS = [
  "schema_version",
  "project_id",
  "generation_id",
  "status",
  "alternatives",
  "created_at",
  "updated_at",
] as const;
const ALTERNATIVE_KEYS = [
  "id",
  "project_id",
  "generation_id",
  "name",
  "status",
  "source_revision",
  "source_digest",
  "result_revision",
  "result_digest",
  "operation_id",
  "entrypoint_url",
  "created_at",
  "updated_at",
] as const;
const DIGEST = /^[a-f0-9]{64}$/;

export function parseCreateVisualAlternativesRequest(
  input: unknown,
): CreateVisualAlternativesRequest {
  const record = decodeContract(input);
  assertKnownKeys(record, REQUEST_KEYS);
  const count = alternativeCount(requiredNumber(record, "count"));
  const prompt = requiredString(record, "prompt").trim();
  const names = requiredArray(record, "names").map((value, index) => {
    if (typeof value !== "string") {
      throw new UpgradeContractError("invalid_field", `names.${index}`);
    }
    const name = value.trim();
    if (name.length === 0 || name.length > 80) {
      throw new UpgradeContractError("invalid_field", `names.${index}`);
    }
    return name;
  });
  if (
    prompt.length === 0 ||
    prompt.length > 20_000 ||
    names.length !== count ||
    new Set(names).size !== names.length
  ) {
    throw new UpgradeContractError("invalid_field", "names");
  }
  return { count, prompt, names };
}

export function parseVisualAlternativeList(
  input: unknown,
): VisualAlternativeList {
  const record = decodeContract(input);
  assertKnownKeys(record, LIST_KEYS);
  const schemaVersion = requiredNumber(record, "schema_version");
  if (schemaVersion !== 1) {
    throw new UpgradeContractError("invalid_field", "schema_version");
  }
  const projectId = requiredString(record, "project_id");
  const generationId = requiredString(record, "generation_id");
  const alternatives = requiredArray(record, "alternatives").map(
    (value, index) => parseAlternative(value, index, projectId),
  );
  return {
    schema_version: 1,
    project_id: projectId,
    generation_id: generationId,
    status: listStatus(requiredString(record, "status")),
    alternatives,
    created_at: requiredNumber(record, "created_at"),
    updated_at: requiredNumber(record, "updated_at"),
  };
}

function parseAlternative(
  input: unknown,
  index: number,
  projectId: string,
): VisualAlternativeSummary {
  const record = decodeContract(input);
  assertKnownKeys(record, ALTERNATIVE_KEYS);
  const prefix = `alternatives.${index}`;
  const alternativeProjectId = requiredString(record, "project_id");
  const alternativeGenerationId = requiredString(record, "generation_id");
  if (alternativeProjectId !== projectId) {
    throw new UpgradeContractError("invalid_field", prefix);
  }
  const sourceDigest = digest(record, "source_digest");
  const resultRevision = nullableNumber(record, "result_revision");
  const resultDigest = nullableDigest(record, "result_digest");
  const entrypointUrl = optionalString(record, "entrypoint_url");
  const status = alternativeStatus(requiredString(record, "status"));
  if (
    (status === "ready" &&
      (resultRevision === null ||
        resultDigest === null ||
        entrypointUrl === null)) ||
    (status !== "ready" && entrypointUrl !== null)
  ) {
    throw new UpgradeContractError("invalid_field", prefix);
  }
  return {
    id: requiredString(record, "id"),
    project_id: alternativeProjectId,
    generation_id: alternativeGenerationId,
    name: requiredString(record, "name"),
    status,
    source_revision: requiredNumber(record, "source_revision"),
    source_digest: sourceDigest,
    result_revision: resultRevision,
    result_digest: resultDigest,
    operation_id: requiredString(record, "operation_id"),
    entrypoint_url: entrypointUrl,
    created_at: requiredNumber(record, "created_at"),
    updated_at: requiredNumber(record, "updated_at"),
  };
}

function alternativeCount(value: number): VisualAlternativeCount {
  if (value === 2 || value === 3 || value === 4) return value;
  throw new UpgradeContractError("invalid_field", "count");
}

function alternativeStatus(value: string): VisualAlternativeStatus {
  switch (value) {
    case "pending":
    case "generating":
    case "ready":
    case "failed":
      return value;
    default:
      throw new UpgradeContractError("unknown_discriminant", "status");
  }
}

function listStatus(value: string): VisualAlternativeListStatus {
  switch (value) {
    case "generating":
    case "ready":
    case "partial":
    case "failed":
      return value;
    default:
      throw new UpgradeContractError("unknown_discriminant", "status");
  }
}

function nullableNumber(record: UnknownRecord, key: string): number | null {
  return record[key] === null ? null : requiredNumber(record, key);
}

function digest(record: UnknownRecord, key: string): string {
  const value = requiredString(record, key);
  if (!DIGEST.test(value)) {
    throw new UpgradeContractError("invalid_field", key);
  }
  return value;
}

function nullableDigest(record: UnknownRecord, key: string): string | null {
  return record[key] === null ? null : digest(record, key);
}

function assertKnownKeys(
  record: UnknownRecord,
  keys: readonly string[],
): void {
  const known = new Set(keys);
  const unexpected = Object.keys(record).find((key) => !known.has(key));
  if (unexpected !== undefined) {
    throw new UpgradeContractError("invalid_field", unexpected);
  }
}
