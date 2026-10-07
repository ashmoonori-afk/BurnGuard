import type { BackendId } from "./app";
import type { TurnErrorCode } from "./events";

export const RUNTIME_CAPABILITIES = [
  "text_generation",
  "file_edits",
  "tool_events",
  "usage",
  "image_generation",
] as const;
export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];

export const RUNTIME_FAILURE_STAGES = [
  "preflight",
  "input",
  "generation",
  "review",
  "publication",
] as const;
export type RuntimeFailureStage = (typeof RUNTIME_FAILURE_STAGES)[number];

export type RuntimePromptTransport = "stdin" | "saved_file";
export type RuntimeModelCatalogSource = "bundled" | "codex_cache" | "not_tracked";
export type RuntimeFailureCode = TurnErrorCode | "interrupted";

export interface RuntimeBackendDiagnostic {
  readonly id: BackendId;
  readonly cli: {
    readonly status: "detected" | "missing";
    readonly version: string | null;
  };
  readonly capabilities: readonly RuntimeCapability[];
  readonly prompt_transport: RuntimePromptTransport;
  readonly model_catalog: {
    readonly source: RuntimeModelCatalogSource;
    readonly fetched_at: number | null;
  };
}

export interface RuntimeFailureDiagnostic {
  readonly project_id: string;
  readonly project_name: string;
  readonly session_id: string;
  readonly backend_id: BackendId;
  readonly turn_id: string | null;
  readonly failed_at: number;
  readonly stage: RuntimeFailureStage;
  readonly code: RuntimeFailureCode;
  readonly can_resume: boolean;
}

export interface RuntimeDiagnostics {
  readonly checked_at: number;
  readonly backends: readonly RuntimeBackendDiagnostic[];
  readonly recent_failures: readonly RuntimeFailureDiagnostic[];
}

export interface RuntimeResumeResult {
  readonly project_id: string;
  readonly session_id: string;
  readonly status: "ready";
  readonly artifact: {
    readonly revision: number;
    readonly digest: string;
  };
}

export class RuntimeDiagnosticsContractError extends Error {
  readonly code = "runtime_diagnostics_invalid";

  constructor() {
    super("runtime_diagnostics_invalid");
    this.name = "RuntimeDiagnosticsContractError";
  }
}

export function parseRuntimeDiagnostics(value: unknown): RuntimeDiagnostics {
  const item = exactRecord(value, ["checked_at", "backends", "recent_failures"]);
  const backends = array(item["backends"]).map(parseBackend);
  if (new Set(backends.map((backend) => backend.id)).size !== backends.length) invalid();
  return {
    checked_at: timestamp(item["checked_at"]),
    backends,
    recent_failures: array(item["recent_failures"]).map(parseFailure),
  };
}

function parseBackend(value: unknown): RuntimeBackendDiagnostic {
  const item = exactRecord(value, ["id", "cli", "capabilities", "prompt_transport", "model_catalog"]);
  const cli = exactRecord(item["cli"], ["status", "version"]);
  const modelCatalog = exactRecord(item["model_catalog"], ["source", "fetched_at"]);
  return {
    id: backendId(item["id"]),
    cli: {
      status: detectedStatus(cli["status"]),
      version: nullableBoundedString(cli["version"], 120),
    },
    capabilities: array(item["capabilities"]).map(capability),
    prompt_transport: promptTransport(item["prompt_transport"]),
    model_catalog: {
      source: modelCatalogSource(modelCatalog["source"]),
      fetched_at: nullableTimestamp(modelCatalog["fetched_at"]),
    },
  };
}

function parseFailure(value: unknown): RuntimeFailureDiagnostic {
  const item = exactRecord(value, [
    "project_id",
    "project_name",
    "session_id",
    "backend_id",
    "turn_id",
    "failed_at",
    "stage",
    "code",
    "can_resume",
  ]);
  return {
    project_id: boundedString(item["project_id"], 128),
    project_name: boundedString(item["project_name"], 200),
    session_id: boundedString(item["session_id"], 128),
    backend_id: backendId(item["backend_id"]),
    turn_id: nullableBoundedString(item["turn_id"], 128),
    failed_at: timestamp(item["failed_at"]),
    stage: failureStage(item["stage"]),
    code: failureCode(item["code"]),
    can_resume: booleanValue(item["can_resume"]),
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const entries = Object.keys(value);
  if (entries.length !== keys.length || entries.some((key) => !keys.includes(key))) invalid();
  return Object.fromEntries(Object.entries(value));
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) invalid();
  return value;
}

function nullableBoundedString(value: unknown, maximum: number): string | null {
  return value === null ? null : boundedString(value, maximum);
}

function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function nullableTimestamp(value: unknown): number | null {
  return value === null ? null : timestamp(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function backendId(value: unknown): BackendId {
  switch (value) {
    case "claude-code":
    case "codex":
    case "gemini":
    case "copilot":
      return value;
    default:
      return invalid();
  }
}

function detectedStatus(value: unknown): RuntimeBackendDiagnostic["cli"]["status"] {
  switch (value) {
    case "detected":
    case "missing":
      return value;
    default:
      return invalid();
  }
}

function capability(value: unknown): RuntimeCapability {
  switch (value) {
    case "text_generation":
    case "file_edits":
    case "tool_events":
    case "usage":
    case "image_generation":
      return value;
    default:
      return invalid();
  }
}

function promptTransport(value: unknown): RuntimePromptTransport {
  switch (value) {
    case "stdin":
    case "saved_file":
      return value;
    default:
      return invalid();
  }
}

function modelCatalogSource(value: unknown): RuntimeModelCatalogSource {
  switch (value) {
    case "bundled":
    case "codex_cache":
    case "not_tracked":
      return value;
    default:
      return invalid();
  }
}

function failureStage(value: unknown): RuntimeFailureStage {
  switch (value) {
    case "preflight":
    case "input":
    case "generation":
    case "review":
    case "publication":
      return value;
    default:
      return invalid();
  }
}

function failureCode(value: unknown): RuntimeFailureCode {
  switch (value) {
    case "graphic_requires_authenticated_codex":
    case "graphic_starter_unchanged":
    case "logo_requires_authenticated_codex":
    case "logo_deliverables_missing":
    case "logo_image_provenance_missing":
    case "logo_directions_invalid":
    case "logo_originality_rejected":
    case "design_review_failed":
    case "commandcode_unavailable":
    case "unsupported_generation_model_effort":
    case "backend_unavailable":
    case "agent_control_files_present":
    case "path_unavailable":
    case "immutable_reference_mutated":
    case "immutable_reference_path_unavailable":
    case "immutable_reference_escaped":
    case "private_input_unavailable":
    case "publication_failed":
    case "operation_conflict":
    case "operation_cancelled":
    case "turn_failed":
    case "deck_source_page_limit":
    case "interrupted":
      return value;
    default:
      return invalid();
  }
}

function invalid(): never {
  throw new RuntimeDiagnosticsContractError();
}
